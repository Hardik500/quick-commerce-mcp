/**
 * Blinkit (formerly Grofers) platform implementation
 * URL: https://blinkit.com
 */
import { BrowserContext, Locator, Page } from 'playwright';
import {
  QuickCommercePlatform,
  Product,
  SearchResult,
  CartSummary,
  OrderPreview,
  CartItem,
  Address,
} from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';

export class BlinkitPlatform extends QuickCommercePlatform {
  // Verified against the live site with an authenticated session
  // (scripts/inspect-blinkit-authed.ts) on 2026-09-29. Blinkit's product
  // grid uses Tailwind utility classes (no semantic names/data-testids), so
  // selectors key off distinctive class combinations instead.
  private selectors = {
    // The homepage search bar is a link (rotating placeholder text) that
    // navigates to /s/, which has the real <input>. Direct navigation to
    // /s/?q=<query> is used instead of clicking through it (see search()).
    searchInput: 'input[placeholder*="Search" i]',
    // Product cards are <div role="button"> whose `id` is the numeric
    // product ID - no stable class/data-testid identifies them, so callers
    // must filter `div[id]` matches to numeric ids (see extractProductResults).
    searchResults: 'div[id]',
    productName: '.tw-text-300.tw-font-semibold.tw-line-clamp-2',
    productQuantity: '.tw-text-200.tw-font-medium.tw-line-clamp-1',
    productPrice: '.tw-text-200.tw-font-semibold',
    productMRP: '.tw-text-200.tw-font-regular.tw-line-through',
    deliveryTime: '.tw-text-050.tw-font-bold.tw-uppercase',
    addToCartButton: '.tw-bg-green-050',
    incrementButton: 'button:has(.icon-plus)',
    decrementButton: 'button:has(.icon-minus)',
    cartIcon: 'button:has-text("Cart"), a[href*="cart"], [data-testid="cart"]',
    // /cart page structure (scripts/inspect-blinkit-authed.ts style probe on
    // 2026-09-29). Class names carry a styled-components hash suffix that can
    // change on redeploy, so match by class-name prefix instead of full class.
    cartItems: '[class*="CartProduct__Container"]',
    cartItemName: '[class*="DefaultProductCard__ProductTitle"]',
    cartItemVariant: '[class*="DefaultProductCard__ProductVariantContainer"]',
    cartItemPrice: '[class*="DefaultProductCard__Price-"]',
    cartStepper: '[class*="AddToCart__UpdatedButtonContainer"]',
    cartStepperMinus: '[class*="AddToCart___StyledDiv-"]',
    billRow: '[class*="BillCard__BillItemContainer"]',
    billLabel: '[class*="BillCard__BillItemLeftHeaderTextContent"]',
    billValue: '[class*="BillCard__BillItemRight"]',
    availability: '[data-testid="out-of-stock"], span[class*="out-of-stock"], div[class*="unavailable"]',
    // Login modal, triggered by clicking the profile icon.
    profileIcon: '[class*="profile" i]',
    phoneInput: 'input[data-test-id="phone-no-text-box"]',
    continueButton: 'button:has-text("Continue")',
    otpInput: '[data-test-id="otp-text-box"]',
    // App-install / location interstitials shown on a fresh page load.
    continueOnWebLink: 'text=Continue on web',
    useLocationButton: 'text=Use my location',
  };

  constructor() {
    super('blinkit', 'https://blinkit.com');
  }

  async initialize(context: BrowserContext): Promise<void> {
    this.context = context;
    this.page = await context.newPage();

    // Blinkit works well with mobile viewport
    await this.page.setViewportSize({ width: 390, height: 844 });

    // Navigate to homepage
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});

    // Handle any initial popups (app-install interstitial, location prompt)
    await this.handleInitialPopups();
  }

  private async handleInitialPopups(): Promise<void> {
    if (!this.page) return;

    try {
      // "Get the app" interstitial shown on every fresh page load.
      const continueOnWeb = await this.page.$(this.selectors.continueOnWebLink);
      if (continueOnWeb) {
        await continueOnWeb.click();
        await continueOnWeb.waitForElementState('hidden', { timeout: 5000 }).catch(() => {});
      }

      // "Select your location" modal - only appears if the session has no
      // saved location yet (a fresh/expired login).
      const useLocationBtn = await this.page.$(this.selectors.useLocationButton);
      if (useLocationBtn) {
        await useLocationBtn.click();
        await useLocationBtn.waitForElementState('hidden', { timeout: 8000 }).catch(() => {});
      }
    } catch {
      // Popups might not appear, that's fine
    }
  }

  async checkLogin(): Promise<{ loggedIn: boolean; otpSent?: boolean; phone?: string }> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // gr_1_accessToken is Blinkit's auth cookie (gr_1 = legacy Grofers
      // brand prefix) - present only once phone+OTP login succeeds.
      const cookies = await this.context!.cookies();
      const authCookie = cookies.find(c => c.name === 'gr_1_accessToken');

      if (authCookie && authCookie.value) {
        this.isLoggedIn = true;
        return { loggedIn: true };
      }

      // If a login flow was already triggered (e.g. by a prior submitOtp
      // attempt) and the OTP screen is showing, report that back so the
      // caller can prompt for the code instead of just "not logged in".
      const otpInput = await this.page.$(this.selectors.otpInput);
      if (otpInput) {
        this.isLoggedIn = false;
        return { loggedIn: false, otpSent: true };
      }

      this.isLoggedIn = false;
      return { loggedIn: false };
    } catch (error) {
      console.error('Error checking login status:', error);
      return { loggedIn: false };
    }
  }

  async submitOtp(otp: string): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      const otpInput = await this.page.$(this.selectors.otpInput);
      if (!otpInput) {
        console.log('OTP input not found');
        return false;
      }

      // OTP is 4 separate single-digit boxes; typing into the first one
      // auto-advances focus through the rest (see scripts/auto-login-blinkit.ts).
      await otpInput.click();
      await this.page.keyboard.type(otp);
      await this.page.locator(this.selectors.otpInput).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

      const loginCheck = await this.checkLogin();
      if (loginCheck.loggedIn) {
        await this.saveSession();
      }
      return loginCheck.loggedIn;
    } catch (error) {
      console.error('Error submitting OTP:', error);
      return false;
    }
  }

  /** Persist cookies + localStorage so the next run starts already logged in. */
  async saveSession(): Promise<void> {
    if (!this.context) return;

    ensureSessionDir();
    const filePath = sessionPath('blinkit');
    await this.context.storageState({ path: filePath });
    console.log('✅ Session saved to', filePath);
  }

  async search(query: string): Promise<SearchResult> {
    if (!this.page) throw new Error('Platform not initialized');
    if (!this.isLoggedIn) {
      throw new Error('Not logged in. Please login first.');
    }

    try {
      // Delivery location is the account's live address (change it with
      // select_address); the /s/?q= page doesn't take a location override.
      await this.page.goto(`${this.baseUrl}/s/?q=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Results render after a skeleton that can outlast a fixed delay on a
      // cold page; a timeout here just means no results.
      await this.page.waitForSelector(this.selectors.productName, { timeout: 15000 }).catch(() => {});

      const products = await this.extractProductResults();

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
      // Cards are <div id="<numeric product id>"> with no other stable
      // selector, so `searchResults` matches every div[id] on the page and
      // needs a numeric-id filter here to isolate the actual cards.
      const allDivsWithId = await this.page.$$(this.selectors.searchResults);
      const productElements = [];
      for (const el of allDivsWithId) {
        const id = await el.evaluate(node => node.id);
        if (/^\d+$/.test(id)) productElements.push(el);
      }

      for (const element of productElements.slice(0, 20)) {
        try {
          // Extract product details
          const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
          const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
          const price = this.parsePrice(priceText);

          // Try to get MRP (crossed out price if exists)
          let mrp: number | undefined;
          try {
            const mrpText = await element.$eval(this.selectors.productMRP, el => el.textContent?.trim());
            if (mrpText) {
              mrp = this.parsePrice(mrpText);
            }
          } catch {
            mrp = undefined;
          }

          // Check availability
          let inStock = true;
          try {
            const outOfStock = await element.$(this.selectors.availability);
            if (outOfStock) {
              inStock = false;
            }
          } catch {
            // Assume in stock
          }

          // Get delivery time if shown
          let deliveryTime: string | undefined;
          try {
            deliveryTime = await element.$eval(this.selectors.deliveryTime, el => el.textContent?.trim());
          } catch {
            deliveryTime = undefined;
          }

          // Quantity/size (e.g. "450 ml") is shown separately from the name.
          let quantity = '1 unit';
          try {
            const qtyText = await element.$eval(this.selectors.productQuantity, el => el.textContent?.trim());
            if (qtyText) quantity = qtyText;
          } catch {
            // Fall back to parsing it out of the name below
            quantity = this.extractQuantity(name);
          }

          const productId = await element.evaluate(el => el.id);

          products.push({
            id: productId,
            name: name || 'Unknown Product',
            price,
            mrp,
            quantity,
            deliveryTime,
            platform: this.name,
            inStock,
          });
        } catch (err) {
          // Skip product if extraction fails
          console.log('Failed to extract product:', err);
        }
      }
    } catch (error) {
      console.error('Error extracting products:', error);
    }

    return products;
  }

  private extractQuantity(name: string): string {
    // Extract quantity info from name like "Amul Milk 1L", "Lays Chips 52g"
    const match = name.match(/(\d+(?:\.\d+)?\s*(?:ml|L|g|kg|pcs|pack|bottle|can)s?)/i);
    return match ? match[1] : '1 unit';
  }

  async addToCart(productId: string, quantity: number): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // The product's numeric id is the card's DOM id directly.
      const product = await this.page.$(`div[id="${productId}"]`);
      if (!product) {
        console.log('Product not found:', productId);
        return false;
      }

      // Click add button
      const addButton = await product.$(this.selectors.addToCartButton);
      if (!addButton) {
        console.log('Add to cart button not found');
        return false;
      }

      await this.afterChange(() => addButton.click());

      // The ADD button turns into a -/qty/+ stepper once the item is in the cart;
      // if it doesn't (e.g. out of stock), the add failed.
      const stepper = await product.waitForSelector(this.selectors.incrementButton, { timeout: 5000 }).catch(() => null);
      if (!stepper) {
        console.log('Item did not land in cart:', productId);
        return false;
      }
      for (let i = 1; i < quantity; i++) {
        const incrementBtn = await product.waitForSelector(this.selectors.incrementButton, { timeout: 5000 }).catch(() => null);
        if (incrementBtn) await this.afterChange(() => incrementBtn.click());
      }

      return true;
    } catch (error) {
      console.error('Error adding to cart:', error);
      return false;
    }
  }

  private async openCart(): Promise<void> {
    if (!this.page) return;
    await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await this.page.locator(this.selectors.cartItems).first().waitFor({ timeout: 5000 }).catch(() => {});
  }

  async getCart(): Promise<CartSummary | null> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();
      const cartItems = await this.extractCartItems();

      // Bill rows (Items total / Delivery charge / Handling charge / Grand
      // total) share one container; match by label text next to it.
      const billValue = async (label: string): Promise<number> => {
        const row = this.page!.locator(this.selectors.billRow).filter({
          has: this.page!.locator(this.selectors.billLabel, { hasText: label }),
        });
        const text = await row.locator(this.selectors.billValue).first().textContent().catch(() => null);
        return text ? this.parsePrice(text) : 0;
      };

      const subtotal = await billValue('Items total');
      const total = await billValue('Grand total');

      return {
        platform: this.name,
        items: cartItems,
        subtotal: subtotal || cartItems.reduce((sum, item) => sum + item.price * item.cartQuantity, 0),
        deliveryFee: total && subtotal ? total - subtotal : 0,
        total: total || subtotal,
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
          const variant = await element.$eval(this.selectors.cartItemVariant, el => el.textContent?.trim() || '1 unit').catch(() => '1 unit');
          const priceText = await element.$eval(this.selectors.cartItemPrice, el => el.textContent?.trim() || '');
          const price = this.parsePrice(priceText);

          // The stepper's quantity is a bare text node between the minus and
          // plus icon divs; both icons render as single glyph characters
          // with no separator, so pull the text node directly.
          const cartQuantity = await element.$eval(this.selectors.cartStepper, (el) => {
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
            return parseInt(textNode?.textContent?.trim() || '1', 10) || 1;
          }).catch(() => 1);

          items.push({
            id: name,
            name,
            price,
            platform: this.name,
            quantity: variant,
            inStock: true,
            cartQuantity,
          });
        } catch {
          // Skip items that fail extraction
        }
      }
    } catch (error) {
      console.error('Error extracting cart items:', error);
    }

    return items;
  }

  async removeFromCart(productId: string): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();
      // Decrement until the row disappears.
      for (let i = 0; i < 50; i++) {
        const row = this.page
          .locator(this.selectors.cartItems)
          .filter({ has: this.page.locator(this.selectors.cartItemName, { hasText: productId }) })
          .first();
        // First pass: the drawer may still be rendering; wait for the row.
        if (i === 0) await row.waitFor({ timeout: 5000 }).catch(() => {});
        if ((await row.count()) === 0) return i > 0;
        await this.afterChange(() => row.locator(this.selectors.cartStepperMinus).click());
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
      for (let i = 0; i < 100; i++) {
        const minus = this.page.locator(`${this.selectors.cartItems} ${this.selectors.cartStepperMinus}`).first();
        if ((await minus.count()) === 0) return true;
        await this.afterChange(() => minus.click());
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
    const bar = page.locator('[class*="LocationBar__Subtitle"]').first();
    await bar.waitFor({ timeout: 15000 });
    await bar.click({ timeout: 8000, force: true });
    const cards = page.locator('[class*="AddressListItem__AddressItemWrapperItem"]');
    await cards.first().waitFor({ timeout: 8000 });
    return cards;
  }

  private selectedAddress?: Address;

  async selectAddress(addressId: string): Promise<boolean> {
    const addr = (await this.getAddresses())[Number(addressId)];
    const lat = async () =>
      (await this.page!.context().cookies()).find(c => c.name === 'gr_1_lat')?.value ?? '';
    const before = await lat();
    const ok = await super.selectAddress(addressId);
    if (ok) {
      this.selectedAddress = addr;
      // Blinkit applies the new location (gr_1_lat/lon cookies) ~2s after the picker
      // closes. Re-selecting the current address changes nothing; the 6s cap covers that.
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && (await lat()) === before) {
        await this.page!.waitForResponse(() => true, { timeout: 500 }).catch(() => {});
      }
    }
    return ok;
  }

  async getOrderPreview(): Promise<OrderPreview | null> {
    if (!this.page) throw new Error('Platform not initialized');
    const cart = await this.getCart();
    if (!cart || cart.items.length === 0) return null;

    try {
      // Proceed -> saved-address list -> pick one -> Proceed To Pay -> payment
      // iframe (Zomato paykit). Nothing is charged until a method is confirmed.
      // The checkout list defaults to its first row and marks no selection, so
      // pick the row matching the address chosen via selectAddress (if any).
      // If the cart already has an address attached, the footer shows
      // "Delivering to X" + "Proceed To Pay" and skips the list.
      const payBtn = this.page.getByText(/^Proceed To Pay/).last();
      const proceed = this.page.getByText('Proceed', { exact: true }).last();
      const first = await Promise.race([
        proceed.waitFor({ timeout: 8000 }).then(() => 'list' as const),
        payBtn.waitFor({ timeout: 8000 }).then(() => 'pay' as const),
      ]).catch(() => null);
      let address = '';
      const selected = this.selectedAddress;
      const wanted = selected?.addressLine1.split(',')[0];
      const readFooter = async () =>
        (await this.page!.getByText(/Delivering to/).first().locator('xpath=../..').innerText({ timeout: 3000 }).catch(() => ''))
          .replace(/\s*\n\s*/g, ', ').replace(/^.*?Delivering to,?\s*/, '').replace(/,?\s*Change.*$/, '');
      // The cart keeps the address from its last checkout, even after the header
      // location changes, so a stale footer must be switched via "Change".
      let useList = first === 'list';
      if (first === 'pay') {
        address = await readFooter();
        if (wanted && !address.toLowerCase().includes(wanted.toLowerCase())) {
          await this.page.getByText('Change', { exact: true }).last().click({ timeout: 5000 });
          useList = true;
        }
      }
      if (useList) {
        if (first === 'list') await proceed.click({ timeout: 8000 });
        const all = this.page.locator('[class*="AddressList__AddressLists"] > *');
        await all.first().waitFor({ timeout: 8000 });
        const match = selected ? all.filter({ hasText: wanted! }).filter({ hasText: selected.label }) : all;
        const row = (await match.count()) > 0 ? match.first() : all.first();
        address = (await row.innerText()).replace(/\s*\n\s*/g, ', ');
        await row.click();
      }
      await payBtn.click({ timeout: 10000 });
      const frameEl = this.page.locator('iframe[src*="zpaykit"]').first();
      await frameEl.waitFor({ timeout: 15000 });
      const frame = this.page.frameLocator('iframe[src*="zpaykit"]').first();
      await frame.getByText(/UPI/).first().waitFor({ timeout: 15000 });
      // Panels are accordions (opening one collapses the other), so open the
      // ones that hide options and accumulate their text.
      let text = await frame.locator('body').innerText();
      for (const title of ['Wallets', 'UPI']) {
        const head = frame.locator('h5', { hasText: new RegExp(`^${title}$`) }).first();
        if (!(await head.count())) continue;
        await head.click({ timeout: 3000 }).catch(() => {});
        await frame.getByText(title === 'UPI' ? /Select UPI APP/i : /LINK|Mobikwik|Paytm/i).first().waitFor({ timeout: 4000 }).catch(() => {});
        text += '\n' + (await frame.locator('body').innerText());
      }
      const paymentMethods = this.scanPaymentMethods(text);
      // The "Cash" panel always carries a "not available below ₹50" note, so
      // trust its enabled state instead (it can be disabled for other reasons too).
      const cash = frame.locator('[role="button"][aria-label="Cash"]').first();
      if ((await cash.count()) && (await cash.getAttribute('aria-disabled')) !== 'true') paymentMethods.push('Cash on Delivery');
      return { cart, address, paymentMethods };
    } catch (error) {
      const body = await this.page.locator('body').innerText().catch(() => '');
      const m = body.match(/[^\n]*(?:not serviceable|unserviceable|not available in your new location|doesn't deliver|not delivering|can't deliver)[^\n]*/i);
      if (m) throw new Error(`Address not serviceable on Blinkit: ${m[0].trim()}`);
      if (/out of stock item/i.test(body)) throw new Error('Cart has an out-of-stock item on Blinkit; remove it before checkout');
      console.error('Error getting order preview:', error);
      return null;
    }
  }

  private armedTotal?: number;

  async placeOrder(paymentMethod: string, confirm = false): Promise<any> {
    if (!this.page) throw new Error('Platform not initialized');
    if (paymentMethod !== 'cod') return { success: false, message: 'Only "cod" is supported on Blinkit.' };
    const frame = this.page.frameLocator('iframe[src*="zpaykit"]').first();
    const payNow = this.page.getByText(/^Pay Now/).last();

    if (!confirm) {
      this.armedTotal = undefined;
      const preview = await this.getOrderPreview();
      if (!preview) return { success: false, message: 'Could not reach checkout (empty cart?).' };
      if (!preview.paymentMethods.includes('Cash on Delivery')) {
        return { success: false, message: 'Cash on Delivery is not enabled for this cart (Blinkit needs an items subtotal of at least ₹50).' };
      }
      await frame.locator('[role="button"][aria-label="Cash"]').first().click({ timeout: 5000 });
      await frame.getByText(/exact change/i).first().waitFor({ timeout: 8000 });
      await payNow.waitFor({ timeout: 5000 });
      this.armedTotal = preview.cart.total;
      return { success: false, ready: true, total: preview.cart.total, message: 'Cash selected; stopped before "Pay Now".' };
    }

    if (this.armedTotal === undefined) return { success: false, message: 'Checkout is not armed; run the first step again.' };
    this.armedTotal = undefined; // one shot, even if the click fails
    // Still on the Cash-selected payment screen?
    const stillThere = await frame.getByText(/exact change/i).first().isVisible().catch(() => false);
    if (!stillThere || !(await payNow.isVisible().catch(() => false))) {
      return { success: false, message: 'Checkout screen changed since the preview; nothing was charged. Run the first step again.' };
    }
    await payNow.click({ timeout: 5000 });
    // ponytail: success signal not yet observed live; report page text for the caller to judge.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    const text = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    return { success: true, message: `"Pay Now" clicked. Page now shows: ${text}` };
  }
}
