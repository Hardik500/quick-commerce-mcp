/**
 * Swiggy Instamart implementation
 * URL: https://www.swiggy.com/instamart
 */
import { BrowserContext, Locator } from 'playwright';
import {
  LoginStatus,
  QuickCommercePlatform,
  Product,
  SearchResult,
  CartSummary,
  OrderPreview,
  CartItem,
} from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';
import { storeNotice, stripPackSize } from '../ranking.js';
import { pick } from '../flows.js';
import type { AddOutcome } from '../engine/add-strategy.js';

/**
 * Instamart bill is one text line per cell: label, then "struck original, actual" or a single amount or "FREE"
 * (e.g. "Handling Fee","₹12.83","₹12.00" / "Delivery Partner Fee","₹30.00","FREE"). Last amount is what's charged.
 */
export function parseInstamartBill(lines: string[]): { subtotal: number; total: number; fees: { label: string; amount: number }[] } {
  const start = lines.findIndex(l => /^bill details$/i.test(l));
  let subtotal = 0, total = 0;
  const fees: { label: string; amount: number }[] = [];
  let label = '', amounts: number[] = [], free = false;
  const flush = () => {
    if (!label || !amounts.length) return;
    const amount = amounts[amounts.length - 1];
    if (/^item total/i.test(label)) subtotal = amount;
    else if (/^to pay/i.test(label)) total = amount;
    else if (!free && amount) fees.push({ label, amount });
  };
  for (const l of lines.slice(start + 1)) {
    if (/^₹/.test(l)) amounts.push(Number(l.replace(/[^\d.]/g, '')));
    else if (/^free$/i.test(l)) free = true;
    else { flush(); if (/^to pay/i.test(label)) break; label = l; amounts = []; free = false; }
  }
  flush();
  return { subtotal, total, fees };
}

export class SwiggyInstamartPlatform extends QuickCommercePlatform {
  // Verified against the live site with an authenticated session
  // (scripts/test-instamart-addtocart.ts) on 2026-09-29. data-testids are used where
  // they exist; card text fields only have hashed CSS-module classes.
  private selectors = {
    // Card root; name/price/qty live in its parent (price row is a sibling).
    searchResults: '[data-testid="item-collection-card-full"]',
    productName: '._1lbNR',
    // The MRP element also carries _2jn41, so exclude it.
    productPrice: '._2jn41:not(._3eAjW)',
    productMRP: '._3eAjW',
    productQuantity: '._3wq_F',
    deliveryTime: '._1y_Uf',
    // Becomes the "+" button once the item is in the cart.
    addToCartButton: '[data-testid="buttonpair-add"]',
    inlineCount: '[data-testid="buttonpair-count"]',
    // Multi-variant items open this sheet instead of adding directly.
    variantSheet: '[data-testid="InstamartItemCustomizationWidget"]',
    variantRow: '[data-testid="variants-container"]',
    variantPrice: '[data-testid="variants-price"]',
    variantSheetClose: '[data-testid="InstamartItemCustomizationWidget-cta"]',
    // Stepper used in the variant sheet and on the cart page.
    stepperAdd: '[data-testid="add_buttons_center"]',
    stepperPlus: '[data-testid="add_buttons_plus"]',
    stepperMinus: '[data-testid="add_buttons_minus"]',
    cartItems: '[data-testid="item-list-available-items-container"] [role="listitem"]',
    cartItemName: '[data-testid="cart-item-name"]',
    cartItemQuantity: '[data-testid="cart-item-quantity"]',
    cartItemCount: '[data-testid="add_buttons_center"]',
    cartItemPrice: '[data-testid="cart-item-price"]',
    otpInput: 'input#otp',
    // Location sheet shown when the session has no saved address. The row that
    // looks like a search box is a DIV; the input appears only after clicking it.
    setGpsButton: '[data-testid="set-gps-button"]',
    locationSearchTrigger: '[data-testid="search-location"]',
  };

  constructor() {
    super('swiggy-instamart', 'https://www.swiggy.com/instamart');
  }

  async initialize(context: BrowserContext): Promise<void> {
    this.context = context;
    this.page = await context.newPage();

    // Swiggy's mobile site shows "Rotate your device" in landscape viewports.
    await this.page.setViewportSize({ width: 390, height: 844 });

    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  }

  /**
   * Swiggy puts up a "Share location to find the closest Instamart store" sheet
   * on any session without a saved address, covering the header at z-index
   * 10001 - the same gate Blinkit has. It renders after hydration, so it has to
   * be waited for rather than queried once after navigation.
   *
   * The sheet is deliberately NOT dismissed here. "Share location" only
   * succeeds when the context reports a real position, and Swiggy's own area
   * search leads to a Google Maps view that leaves the page unusable for
   * automation. The sheet carries its own Login button, which closes the sheet
   * on click, so sendOtp logs in through that instead. A saved address is what
   * actually needs a location, and list_addresses/select_address handle it once
   * logged in.
   *
   * Returns a note about the sheet's presence, or null when there is none.
   */
  private async handleLocationPopup(): Promise<string | null> {
    if (!this.page) return 'page not initialised';
    const present = await this.page
      .getByText('Share location to find the closest', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true, () => false);
    return present ? "Swiggy's \"Share location\" sheet is open" : null;
  }

  async checkLogin(): Promise<LoginStatus> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // _session_tid is set only after OTP login and persists for a year
      // (_is_logged_in is a session cookie, so it's dropped between runs).
      const cookies = await this.context!.cookies();
      const authCookie = cookies.find(c => c.name === '_session_tid');

      if (authCookie && authCookie.value) {
        this.isLoggedIn = true;
        this.sessionVerified = true;
        return { loggedIn: true };
      }

      const otpInput = await this.page.$(this.selectors.otpInput);
      if (otpInput) {
        this.isLoggedIn = false;
        this.sessionVerified = true;
        return { loggedIn: false, otpSent: true };
      }

      this.isLoggedIn = false;
      this.sessionVerified = true;
      return { loggedIn: false };
    } catch (error) {
      // A failed check is not a logged-out account - see the note in base.ts.
      console.error('Error checking login status:', error);
      this.isLoggedIn = false;
      this.sessionVerified = false;
      return {
        loggedIn: false,
        indeterminate: true,
        reason: `the check itself failed (${(error as Error)?.message?.split('\n')[0] ?? 'unknown error'})`,
      };
    }
  }

  async sendOtp(phone: string): Promise<boolean> {
    const page = this.page;
    if (!page) throw new Error('Platform not initialized');
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const blocked = await this.handleLocationPopup();
    const tel = page.locator('[data-testid="input-field-tel-national"]');
    if (!(await tel.count())) {
      try {
        // The location sheet has its own Login button, and it closes itself on
        // click. That is the reliable way in: the header's account icon sits
        // under the sheet's z-index 10001 backdrop and cannot be clicked at all.
        const sheetLogin = page.locator('[data-testid="login-button"]').first();
        if (await sheetLogin.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
          await sheetLogin.click({ timeout: 10000 });
        } else {
          await page.locator('[data-testid="user-account-icon"]').click({ timeout: 10000 });
        }
      } catch {
        // A bare timeout here means the sheet is still on top of the header;
        // name it rather than reporting a click timeout.
        const stillBlocked = await this.handleLocationPopup();
        throw new Error(
          `Could not reach Swiggy's login form: ${blocked ?? stillBlocked ?? 'the header was covered by a modal'}. ` +
          'Save a pincode with set_preferences(pincode: "..."), or run ' +
          '`npx -y -p quick-commerce-mcp quick-commerce-mcp-login swiggy-instamart` to log in by hand.',
        );
      }
    }
    await tel.waitFor({ timeout: 15000 });
    // Clear, then type through the locator. `page.keyboard.type()` after a click
    // drops the first character here, which reads as a 9-digit cap and is not
    // one: the field accepts a full 10-digit number.
    let typed = '';
    for (let i = 0; i < 4 && typed !== phone; i++) {
      await tel.click({ timeout: 5000 }).catch(() => {});
      await tel.fill('').catch(() => {});
      await tel.pressSequentially(phone, { delay: 60 }).catch(() => {});
      typed = (await tel.inputValue().catch(() => '')).replace(/\D/g, '');
      // The field intermittently swallows the last keystroke, so top the value
      // up instead of discarding an otherwise correct number.
      for (let j = 0; j < 2 && typed !== phone && typed.length < phone.length; j++) {
        await tel.click({ timeout: 5000 }).catch(() => {});
        await page.keyboard.press('End').catch(() => {});
        await tel.pressSequentially(phone.slice(typed.length), { delay: 120 }).catch(() => {});
        typed = (await tel.inputValue().catch(() => '')).replace(/\D/g, '');
      }
    }
    // Never submit a number the field did not accept: Swiggy would text a
    // different person than the one the user gave us.
    if (typed !== phone) {
      throw new Error(
        `Swiggy's phone field only accepted ${typed.length} of ${phone.length} digits ("${typed}"), so no OTP was requested ` +
        'rather than being sent to the wrong number. Indian mobile numbers start 6-9; a number starting with 0, 1 or 2 is ' +
        'dropped to 9 digits by the site. Check the number with the user.',
      );
    }
    const continueBtn = page.locator('button:has-text("CONTINUE")').first();
    await continueBtn.click({ timeout: 10000 });
    return page.locator(this.selectors.otpInput).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  }

  async submitOtp(otp: string): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      const otpInput = await this.page.$(this.selectors.otpInput);
      if (!otpInput) {
        console.log('OTP input not found');
        return false;
      }

      // Controlled React input: fill() doesn't register, real keystrokes do.
      await otpInput.click();
      await otpInput.press('ControlOrMeta+A');
      await otpInput.press('Backspace');
      await this.page.keyboard.type(otp, { delay: 80 });

      const verifyBtn = await this.page.$('button:has-text("VERIFY"), button:has-text("CONTINUE")');
      if (verifyBtn) await verifyBtn.click().catch(() => {});
      await this.page.locator(this.selectors.otpInput).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

      // The form can disappear while verification is still in flight. Save
      // only once the authenticated cookie arrives, including slow hydration.
      const deadline = Date.now() + 15000;
      do {
        if ((await this.checkLogin()).loggedIn) {
          await this.saveSession();
          return true;
        }
        await this.page.waitForTimeout(200);
      } while (Date.now() < deadline);
      return false;
    } catch (error) {
      console.error('Error submitting OTP:', error);
      return false;
    }
  }

  /** Persist cookies + localStorage so the next run starts already logged in. */
  async saveSession(): Promise<void> {
    if (!this.context) return;

    ensureSessionDir();
    const filePath = sessionPath('swiggy-instamart');
    await this.context.storageState({ path: filePath });
    console.log('✅ Session saved to', filePath);
  }

  async search(query: string): Promise<SearchResult> {
    if (!this.page) throw new Error('Platform not initialized');
    // Verifies the session itself if nobody has yet, rather than trusting a flag
    // this method never set - see ensureSession in base.ts.
    await this.ensureSession();

    try {
      // Delivery location comes from the saved session; `location` is
      // accepted for interface parity but unused here.
      await this.page.goto(
        `${this.baseUrl}/search?custom_back=true&query=${encodeURIComponent(query)}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      );

      try {
        await this.page.waitForSelector(this.selectors.searchResults, { timeout: 15000 });
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      } catch {
        console.log('No search results found');
      }

      const products = await this.extractProductResults();
      this.rememberSearch(query, products);

      return {
        query,
        platform: this.name,
        products,
        totalResults: products.length,
      };
    } catch (error) {
      console.error('Error searching:', error);
      return {
        query,
        platform: this.name,
        products: [],
        totalResults: 0,
      };
    }
  }

  private async extractProductResults(): Promise<Product[]> {
    if (!this.page) return [];

    const products: Product[] = [];

    try {
      const productElements = await this.page.$$(this.selectors.searchResults);

      for (const element of productElements.slice(0, 20)) {
        try {
          const s = this.selectors;
          // No named helper functions inside evaluate(): tsx injects a
          // `__name` wrapper that doesn't exist in the browser.
          const [name, price, mrp, quantity, deliveryTime] = await element.evaluate(
            (card, sels) => sels.map(q => card.parentElement!.querySelector(q)?.textContent?.trim() || ''),
            [s.productName, s.productPrice, s.productMRP, s.productQuantity, s.deliveryTime]
          );
          const data = { name, price, mrp, quantity, deliveryTime };

          if (!data.name) continue;
          // Cards expose no stable ID. Retain the full search label, including
          // pack size, and remember its query for later cart/address navigation.
          products.push({
            id: this.productIdentity(data.name, data.quantity),
            name: data.name || 'Unknown Product',
            price: this.parsePrice(data.price),
            mrp: data.mrp ? this.parsePrice(data.mrp) : undefined,
            quantity: data.quantity || this.extractQuantity(data.name),
            deliveryTime: data.deliveryTime || undefined,
            platform: this.name,
            inStock: !/out of stock|sold out|unavailable/i.test(await element.innerText()),
          });
        } catch {
          // Skip failed products
        }
      }
    } catch (error) {
      console.error('Error extracting products:', error);
    }

    return products;
  }

  private extractQuantity(name: string): string {
    const match = name.match(/(\d+\s*(?:ml|L|g|kg|pcs|pack))/i);
    return match ? match[1] : '1 unit';
  }

  private productIdentity(name: string, size: string): string {
    return size && stripPackSize(name) === name ? `${name} (${size})` : name;
  }

  async addToCart(productId: string, quantity: number): Promise<AddOutcome> {
    if (!this.page) throw new Error('Platform not initialized');
    this.lastAddBlocker = null;
    if (!Number.isInteger(quantity) || quantity < 1) return 'failed';

    try {
      let card = await this.findProductCard(productId);
      if (!card) {
        await this.restoreProductSearch(productId);
        card = await this.findProductCard(productId);
      }
      if (!card) return 'not-found';
      if (await card.getByText(/out of stock|sold out|unavailable/i).first().isVisible().catch(() => false)) return 'unavailable';
      return await this.addFromCard(card, quantity);
    } catch (error) {
      this.lastAddBlocker = (error as Error).message.split('\n')[0];
      const sheet = this.page.locator(this.selectors.variantSheet);
      if (await sheet.isVisible().catch(() => false)) {
        await sheet.locator(this.selectors.variantSheetClose).click({ timeout: 3000 }).catch(() => {});
      }
      console.error('Error adding to cart:', error);
      return 'failed';
    }
  }

  private async findProductCard(productId: string): Promise<Locator | null> {
    const cards = this.page!.locator(this.selectors.searchResults);
    const fields = await cards.evaluateAll((elements, selectors) => elements.map(el => selectors.map(selector =>
      el.parentElement?.querySelector(selector)?.textContent?.trim() || '')),
    [this.selectors.productName, this.selectors.productQuantity]);
    const names = fields.map(([name, size]) => this.productIdentity(name, size));
    const norm = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();
    let matches = names.map((name, i) => ({ name, i })).filter(x => norm(x.name) === norm(productId));
    // Legacy callers may pass a bare title. Never choose the first of several
    // different packs, or interpolate a product label into a CSS selector.
    if (!matches.length && stripPackSize(productId) === productId) matches = names.map((name, i) => ({ name, i }))
      .filter(x => norm(stripPackSize(x.name)) === norm(stripPackSize(productId)));
    return matches.length === 1 ? cards.nth(matches[0].i) : null;
  }

  /** Click through a located product card to put `quantity` in the cart. */
  private async addFromCard(card: Locator, quantity: number): Promise<AddOutcome> {
    const page = this.page;
    if (!page) throw new Error('Platform not initialized');

    // Multi-variant products open a bottom sheet after the click; single-variant
    // ones turn into an inline stepper where buttonpair-add becomes the "+".
    // Both are handled inside the shared ladder so the first click stays bounded
    // and the result is still proved rather than assumed.
    const outcome = await this.withCartWrites(() => this.addViaCard(
      card,
      {
        add: [this.selectors.addToCartButton],
        landed: [this.selectors.inlineCount],
        increment: [this.selectors.addToCartButton],
        between: async c => {
          const sheet = page.locator(this.selectors.variantSheet);
          const sheetOpened = await sheet
            .waitFor({ state: 'visible', timeout: 2500 })
            .then(() => true, () => false);
          if (!sheetOpened) {
            // No sheet, so the add went straight onto the card. The count
            // element only renders once the add request reaches the server, so
            // settle before handing the proof back - without this the inline
            // path is checked while the site is still thinking, and a successful
            // add gets reported as a failure.
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            const count = c.locator(this.selectors.inlineCount);
            await count.filter({ hasText: /^\s*1\s*$/ }).waitFor({ state: 'visible', timeout: 8000 });
            for (let i = 1; i < quantity; i++) {
              await this.incrementQuantity(c, i + 1, this.selectors.addToCartButton, this.selectors.inlineCount);
            }
            return true;
          }

          const [cardPrice, cardSize] = await c.evaluate(
            (el, sels) => sels.map(sel => el.parentElement?.querySelector(sel)?.textContent?.trim() || ''),
            [this.selectors.productPrice, this.selectors.productQuantity]
          );
          const rows = sheet.locator(this.selectors.variantRow);
          const matches: number[] = [];
          const norm = (text: string) => text.toLowerCase().replace(/\s+/g, '');
          const sizePattern = new RegExp(`(?:^|[^\\d.])${norm(cardSize).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z\\d])`, 'i');
          for (let i = 0; i < (await rows.count().catch(() => 0)); i++) {
            const p = await rows.nth(i).locator(this.selectors.variantPrice).textContent().catch(() => null);
            const text = await rows.nth(i).innerText();
            if (p && this.parsePrice(p) === this.parsePrice(cardPrice) &&
              (!cardSize || sizePattern.test(norm(text)))) matches.push(i);
          }
          if (matches.length !== 1) {
            throw new Error('Instamart did not offer an unambiguous matching pack; no variant was added');
          }
          const row = rows.nth(matches[0]);
          const count = row.locator(this.selectors.stepperAdd);
          const current = Number((await count.innerText()).trim()) || 0;
          // An existing variant is idempotent too; its ADD control is also the
          // quantity counter, so blindly clicking it can increment the basket.
          if (!current) {
            await this.changeQuantity(row, () => count.click({ timeout: 5000 }), 1);
            for (let i = 1; i < quantity; i++) {
              await this.incrementQuantity(row, i + 1, this.selectors.stepperPlus, this.selectors.cartItemCount);
            }
          }
          await sheet.locator(this.selectors.variantSheetClose).click({ timeout: 5000 });
          await sheet.waitFor({ state: 'hidden', timeout: 5000 });
          return true;
        },
      },
      quantity,
    ), false);

    if (outcome !== 'added' && outcome !== 'already') console.log(`Add to cart did not complete (${outcome})`);
    return outcome;
  }

  async getCart(): Promise<CartSummary | null> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();

      const cartItems = await this.extractCartItems();
      const lines = await this.page.evaluate(() => document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean));
      const bill = parseInstamartBill(lines);
      const subtotal = bill.subtotal || cartItems.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
      const total = bill.total || subtotal;

      return {
        platform: this.name,
        items: cartItems,
        subtotal,
        deliveryFee: Math.max(0, total - subtotal),
        fees: bill.fees,
        total,
        notice: storeNotice(await this.page.locator('body').innerText().catch(() => '')),
      };
    } catch (error) {
      console.error('Error getting cart:', error);
      return null;
    }
  }

  private async extractCartItems(): Promise<CartItem[]> {
    if (!this.page) return [];

    const items: CartItem[] = [];

    try {
      const cartElements = await this.page.$$(this.selectors.cartItems);

      for (const element of cartElements) {
        try {
          const name = await element.$eval(this.selectors.cartItemName, el => el.textContent?.trim() || '');
          const size = await element.$eval(this.selectors.cartItemQuantity, el => el.textContent?.trim() || '');
          const countText = await element.$eval(this.selectors.cartItemCount, el => el.textContent?.trim() || '1');
          const cartQuantity = parseInt(countText, 10);
          if (!Number.isFinite(cartQuantity) || cartQuantity <= 0) continue;
          // cart-item-price is the line total.
          const lineTotal = this.parsePrice(await element.$eval(this.selectors.cartItemPrice, el => el.textContent?.trim() || ''));

          items.push({
            id: name,
            name,
            price: lineTotal / cartQuantity,
            platform: this.name,
            quantity: size || '1 unit',
            inStock: true,
            cartQuantity,
          });
        } catch {
          // Skip failed items
        }
      }
    } catch (error) {
      console.error('Error extracting cart items:', error);
    }

    return items;
  }

  private async openCart(): Promise<void> {
    if (!this.page) return;
    await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.locator(this.selectors.cartItems).first().waitFor({ timeout: 5000 }).catch(() => {});
  }

  /** Wait for this counter and the writes caused by its click, not unrelated
   * page text. The site renders counts optimistically before saving the cart. */
  private async incrementQuantity(row: Locator, expected: number, builtin: string, countSelector: string): Promise<void> {
    const plus = await pick(row, this.name, 'cartIncrement', [builtin]);
    if (!plus) throw new Error('Instamart increment control was not found');
    await this.changeQuantity(row, () => plus.locator.click({ timeout: 3000 }), expected, countSelector);
  }

  private async changeQuantity(row: Locator, action: () => Promise<unknown>, expected: number,
    countSelector = this.selectors.cartItemCount): Promise<void> {
    await this.withCartWrites(async () => {
      await action();
      const count = row.locator(countSelector);
      if (expected) await count.filter({ hasText: new RegExp(`^\\s*${expected}\\s*$`) })
        .waitFor({ state: 'visible', timeout: 5000 });
      else await count.filter({ hasText: /^\s*[1-9]\d*\s*$/ })
        .waitFor({ state: 'hidden', timeout: 5000 });
    });
  }

  private async withCartWrites<T>(action: () => Promise<T>, requireWrite = true): Promise<T> {
    const page = this.page!;
    const pending: Promise<import('playwright').Response | null>[] = [];
    const isWrite = (request: import('playwright').Request) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
      new URL(request.url()).origin === new URL(this.baseUrl).origin &&
      /cart/i.test(new URL(request.url()).pathname);
    // Instamart debounces writes after the optimistic counter has changed.
    // Install this before clicking so reload cannot cancel that pending write.
    const firstWrite = requireWrite ? page.waitForRequest(isWrite, { timeout: 5000 }).catch(() => null) : null;
    const track = (request: import('playwright').Request) => {
      if (!isWrite(request)) return;
      pending.push(page.waitForResponse(response => response.request() === request,
        { timeout: 10000 }).catch(() => null));
    };
    page.on('request', track);
    try {
      const result = await action().then(value => ({ value }), error => ({ error }));
      if (firstWrite && !(await firstWrite)) {
        if ('error' in result) throw result.error;
        throw new Error('Instamart did not send the cart update');
      }
      for (const committed of pending) {
        const response = await committed;
        if (!response?.ok()) throw new Error('Instamart did not confirm the cart update');
        const error = await response.finished();
        if (error) throw error;
        // Swiggy wraps application errors in HTTP 200, sometimes in a second
        // data/statusCode envelope. A transport success is not a saved basket.
        const body = await response.json().catch(() => null);
        const rejected = [body, body?.data].find(data => typeof data?.statusCode === 'number' && data.statusCode !== 0);
        if (rejected) {
          if (/address/i.test(rejected.statusMessage || '')) {
            throw new Error('Instamart has no valid delivery address for this session; use list_addresses/select_address, then retry');
          }
          throw new Error(`Instamart rejected the cart update (code ${rejected.statusCode}); check get_cart_summary before retrying`);
        }
      }
      if ('error' in result) throw result.error;
      return result.value;
    } finally { page.off('request', track); }
  }

  private activeCartRows(): Locator {
    return this.page!.locator(this.selectors.cartItems).filter({
      has: this.page!.locator(this.selectors.cartItemCount).filter({ hasText: /^\s*[1-9]\d*\s*$/ }),
    });
  }

  private async decrementCartRow(row: Locator): Promise<void> {
    const before = Number((await row.locator(this.selectors.cartItemCount).innerText()).trim());
    if (!Number.isInteger(before) || before < 1) throw new Error('Could not read Instamart cart quantity');
    // Some site layouts overlay the stepper with the other-items container.
    await this.changeQuantity(row, () => row.locator(this.selectors.stepperMinus).dispatchEvent('click'), before - 1);
  }

  async removeFromCart(productId: string): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();
      const name = stripPackSize(this.getProductName(productId) || productId);
      const exactName = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      let removed = false;
      for (let i = 0; i < 50; i++) {
        const rows = this.activeCartRows().filter({ has: this.page.locator(this.selectors.cartItemName, { hasText: exactName }) });
        if ((await rows.count()) === 0) return removed;
        if ((await rows.count()) !== 1) return false;
        await this.decrementCartRow(rows.first());
        removed = true;
      }
      return false;
    } catch (error) {
      console.error('Error removing from cart:', error);
      return false;
    }
  }

  async clearCart(): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();
      // Unavailable items sit outside the stepper list and block checkout; "Remove all" drops them.
      const removeAll = this.page.getByText('Remove all', { exact: true }).first();
      if (await removeAll.isVisible().catch(() => false)) {
        await this.withCartWrites(async () => {
          await removeAll.click({ timeout: 5000 });
          await removeAll.waitFor({ state: 'hidden', timeout: 5000 });
        });
      }
      for (let i = 0; i < 100; i++) {
        const row = this.activeCartRows().first();
        if ((await row.count()) === 0) return !(await removeAll.isVisible().catch(() => false));
        await this.decrementCartRow(row);
      }
      return false;
    } catch (error) {
      console.error('Error clearing cart:', error);
      return false;
    }
  }

  protected async openAddressPicker(): Promise<Locator> {
    const page = this.page!;
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const name = page.locator('[data-testid="address-name"]').first();
    await name.waitFor({ timeout: 15000 });
    await name.click({ timeout: 8000, force: true });

    // The first click opens a sheet that lists only the current address plus a
    // "See all" link; the full list of saved addresses is one more click away.
    // Clicking "See all" is best-effort: the sheet already renders every row on
    // some builds, and there the link is absent or covered.
    const heading = page.getByText('Select from saved address', { exact: true }).first();
    if (!(await heading.waitFor({ timeout: 6000 }).then(() => true, () => false))) {
      const seeAll = page.locator('[data-testid="address-selector-see-all"]').first();
      if (await seeAll.isVisible().catch(() => false)) {
        await seeAll.click({ timeout: 8000 }).catch(() => {});
        await heading.waitFor({ timeout: 8000 });
      }
    }
    if (!(await heading.isVisible().catch(() => false))) {
      throw new Error("Instamart's saved-address list did not open");
    }
    return heading.locator('xpath=../following-sibling::div[1]/div');
  }

  // Instamart only refreshes its lat/lng/address cookies on the next page load;
  // without a reload the cart still uses the stale (e.g. Mumbai) location.
  async selectAddress(addressId: string, retried = false): Promise<boolean> {
    // Reloading before the select-location POST completes aborts it and the
    // old address sticks, so wait for that response first.
    const saved = this.page!.waitForResponse(r => r.url().includes('select-location'), { timeout: 15000 }).catch(() => null);
    const ok = await super.selectAddress(addressId, retried);
    if (ok) {
      await saved;
      await this.page!.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page!.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
    return ok;
  }

  async getOrderPreview(): Promise<OrderPreview | null> {
    if (!this.page) throw new Error('Platform not initialized');
    const cart = await this.getCart();
    if (!cart || cart.items.length === 0) return null;

    try {
      // The cart footer button is "Proceed to Pay" only once a delivery address
      // is set. Without one it reads "Select Address" and checkout cannot start,
      // which is why the old wait for /proceed to pay/ just timed out. Select the
      // saved address first, then come back for the real button.
      const selectAddr = this.page.locator('[data-testid="cart-generic-footer-button"]').first();
      const payBtn = this.page.getByText(/proceed to pay/i).last();
      const banner = this.page.getByText(/currently (unserviceable|closed)|not accepting orders|add address to proceed/i).first();
      await selectAddr.or(payBtn).or(banner).first().waitFor({ timeout: 20000 });

      if (await selectAddr.isVisible().catch(() => false) &&
        /select address|add address/i.test(await selectAddr.innerText())) {
        const addresses = await this.getAddresses().catch(() => []);
        if (addresses.length === 0) {
          throw new Error(
            'No delivery address is set on Instamart and none are saved. Add one in the app, then retry - ' +
            'the cart shows "Select Address" instead of "Proceed to Pay" until it is set.',
          );
        }
        if (!(await this.selectAddress('0'))) {
          throw new Error('Could not select the saved Instamart address, so checkout cannot start.');
        }
        // The address pick navigates; come back to the cart for the pay button.
        await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await payBtn.or(banner).first().waitFor({ timeout: 20000 });
      }

      if (!(await payBtn.isVisible().catch(() => false))) {
        console.error('Instamart store notice, no "Proceed to Pay" available:', await banner.innerText().catch(() => '(no banner)'));
        return null;
      }
      await payBtn.click({ timeout: 10000 });
      await this.page.waitForURL(/payment/, { timeout: 15000 });
      await this.page.getByText(/UPI/i).first().waitFor({ timeout: 15000 });
      const text = await this.page.locator('body').innerText();
      const address = (await this.page.getByText(/delivering to|deliver to/i).first().innerText().catch(() => '')).replace(/\s*\n\s*/g, ' - ');
      return { cart, address, paymentMethods: this.scanPaymentMethods(text) };
    } catch (error) {
      console.error('Error getting order preview:', error);
      return null;
    }
  }

  private armedTotal?: number;

  async placeOrder(paymentMethod: string, confirm = false, provider?: string): Promise<any> {
    if (!this.page) throw new Error('Platform not initialized');
    if (paymentMethod === 'wallet') return this.placeWalletOrder(confirm, provider);
    if (paymentMethod !== 'cod') return { success: false, message: 'Only "cod" is supported on Instamart.' };
    // "Pay on Delivery" opens a sub-page whose single "Cash/Pay on Delivery" button is the final click.
    const finalBtn = this.page.getByText(/^Cash\/Pay on Delivery$/).first();

    if (!confirm) {
      this.armedTotal = undefined;
      const preview = await this.getOrderPreview();
      if (!preview) return { success: false, message: 'Could not reach checkout (empty cart?).' };
      if (!preview.paymentMethods.includes('Pay on Delivery')) {
        return { success: false, message: 'Pay on Delivery is not offered for this cart on Instamart.' };
      }
      await this.page.getByText(/^Pay on Delivery$/).first().click({ timeout: 5000 });
      await finalBtn.waitFor({ timeout: 8000 });
      this.armedTotal = preview.cart.total;
      return { success: false, ready: true, total: preview.cart.total, message: 'Pay on Delivery opened; stopped before the final click.' };
    }

    if (this.armedTotal === undefined) return { success: false, message: 'Checkout is not armed; run the first step again.' };
    this.armedTotal = undefined; // one shot, even if the click fails
    if (!(await finalBtn.isVisible().catch(() => false))) {
      return { success: false, message: 'Checkout screen changed since the preview; nothing was charged. Run the first step again.' };
    }
    await finalBtn.click({ timeout: 5000 });
    // ponytail: success signal not yet observed live; report page text for the caller to judge.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    const text = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    return { success: true, message: `"Cash/Pay on Delivery" clicked. Page now shows: ${text}` };
  }
}
