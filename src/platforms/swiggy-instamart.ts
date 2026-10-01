/**
 * Swiggy Instamart implementation
 * URL: https://www.swiggy.com/instamart
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
import { storeNotice } from '../ranking.js';

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
    // Location modal shown when the session has no saved address.
    setGpsButton: '[data-testid="set-gps-button"]',
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

    await this.handleLocationPopup();
  }

  private async handleLocationPopup(): Promise<void> {
    if (!this.page) return;

    try {
      const gps = await this.page.$(this.selectors.setGpsButton);
      if (gps) {
        await gps.click();
        await gps.waitForElementState('hidden', { timeout: 8000 }).catch(() => {});
      }
    } catch {
      // No popup, that's fine
    }
  }

  async checkLogin(): Promise<{ loggedIn: boolean; otpSent?: boolean; phone?: string }> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // _session_tid is set only after OTP login and persists for a year
      // (_is_logged_in is a session cookie, so it's dropped between runs).
      const cookies = await this.context!.cookies();
      const authCookie = cookies.find(c => c.name === '_session_tid');

      if (authCookie && authCookie.value) {
        this.isLoggedIn = true;
        return { loggedIn: true };
      }

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

      // Controlled React input: fill() doesn't register, real keystrokes do.
      await otpInput.click();
      await this.page.keyboard.type(otp, { delay: 80 });

      const verifyBtn = await this.page.$('button:has-text("VERIFY"), button:has-text("CONTINUE")');
      if (verifyBtn) await verifyBtn.click().catch(() => {});
      await this.page.locator(this.selectors.otpInput).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

      // Check if login succeeded
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
    const filePath = sessionPath('swiggy-instamart');
    await this.context.storageState({ path: filePath });
    console.log('✅ Session saved to', filePath);
  }

  async search(query: string): Promise<SearchResult> {
    if (!this.page) throw new Error('Platform not initialized');
    if (!this.isLoggedIn) {
      throw new Error('Not logged in. Please login first.');
    }

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

          // ponytail: cards expose no product id, so the name is the id; addToCart
          // looks the card up by name on the current results page.
          products.push({
            id: data.name,
            name: data.name || 'Unknown Product',
            price: this.parsePrice(data.price),
            mrp: data.mrp ? this.parsePrice(data.mrp) : undefined,
            quantity: data.quantity || this.extractQuantity(data.name),
            deliveryTime: data.deliveryTime || undefined,
            platform: this.name,
            inStock: true,
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

  async addToCart(productId: string, quantity: number): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // productId is the product name (see extractProductResults).
      const card = this.page
        .locator(this.selectors.searchResults)
        .filter({ has: this.page.locator(`img[alt="${productId.replace(/"/g, '\\"')}"]`) })
        .first();
      if ((await card.count()) === 0) {
        console.log('Product not found:', productId);
        return false;
      }

      const cardPrice = await card.evaluate(
        (c, sel) => c.parentElement!.querySelector(sel)?.textContent?.trim() || '',
        this.selectors.productPrice
      );

      await card.locator(this.selectors.addToCartButton).click();

      // Multi-variant products open a bottom sheet; single-variant ones turn
      // into an inline stepper. Wait for the sheet, bounded.
      const sheet = this.page.locator(this.selectors.variantSheet);
      const sheetOpened = await sheet.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
      if (sheetOpened) {
        // Pick the variant matching the card's price (the single-unit pack),
        // falling back to the first variant.
        const rows = sheet.locator(this.selectors.variantRow);
        let row = rows.first();
        for (let i = 0; i < (await rows.count()); i++) {
          const p = await rows.nth(i).locator(this.selectors.variantPrice).textContent();
          if (p?.trim() === cardPrice) {
            row = rows.nth(i);
            break;
          }
        }
        await this.afterChange(() => row.locator(this.selectors.stepperAdd).click());
        for (let i = 1; i < quantity; i++) {
          await this.afterChange(() => row.locator(this.selectors.stepperPlus).click());
        }
        await sheet.locator(this.selectors.variantSheetClose).click();
        await sheet.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      } else {
        // Single-variant: ADD turns into an inline stepper; the same
        // buttonpair-add element is the "+" button.
        for (let i = 1; i < quantity; i++) {
          await this.afterChange(() => card.locator(this.selectors.addToCartButton).click());
        }
      }

      // Let the add request reach the server before the caller navigates away.
      await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

      // The card shows a quantity counter once the item is in the cart.
      const landed = await card.locator('[data-testid="buttonpair-count"]').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      if (!landed) console.log('Item did not land in cart:', productId);
      return landed;
    } catch (error) {
      console.error('Error adding to cart:', error);
      return false;
    }
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
          const cartQuantity = parseInt(countText) || 1;
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
        if ((await row.count()) === 0) return i > 0;
        // dispatchEvent: a sibling "other items" container can overlay the button.
        await this.afterChange(() => row.locator(this.selectors.stepperMinus).dispatchEvent('click'));
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
        await removeAll.click({ timeout: 5000 });
        await this.page.getByText(/items? unavailable/i).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
      for (let i = 0; i < 100; i++) {
        const minus = this.page.locator(`${this.selectors.cartItems} ${this.selectors.stepperMinus}`).first();
        if ((await minus.count()) === 0) return true;
        await this.afterChange(() => minus.dispatchEvent('click'));
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
    const heading = page.getByText('Select from saved address', { exact: true }).first();
    await heading.waitFor({ timeout: 8000 });
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
      // 'Proceed to Pay' leads to /instamart/payment, which lists the methods.
      // The page ends in either the pay button or a closed/unserviceable banner; wait for whichever shows first.
      const btn = this.page.getByText(/proceed to pay/i).last();
      const banner = this.page.getByText(/currently (unserviceable|closed)|not accepting orders|add address to proceed/i).first();
      await btn.or(banner).waitFor({ timeout: 20000 });
      if (!(await btn.isVisible())) {
        console.error('Instamart store notice, no "Proceed to Pay" available:', await banner.innerText());
        return null;
      }
      await btn.click({ timeout: 10000 });
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

  async placeOrder(paymentMethod: string, confirm = false): Promise<any> {
    if (!this.page) throw new Error('Platform not initialized');
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
