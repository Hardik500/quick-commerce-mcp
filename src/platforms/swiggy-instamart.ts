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
  CartItem,
  Address,
} from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';

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
    await this.page.waitForTimeout(3000);

    await this.handleLocationPopup();
  }

  private async handleLocationPopup(): Promise<void> {
    if (!this.page) return;

    try {
      const gps = await this.page.$(this.selectors.setGpsButton);
      if (gps) {
        await gps.click();
        await this.page.waitForTimeout(2000);
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
      await this.page.waitForTimeout(1500);

      const verifyBtn = await this.page.$('button:has-text("VERIFY"), button:has-text("CONTINUE")');
      if (verifyBtn) await verifyBtn.click().catch(() => {});
      await this.page.waitForTimeout(5000);

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

  async search(query: string, location?: string): Promise<SearchResult> {
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
        await this.page.waitForTimeout(1500);
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
      await this.page.waitForTimeout(1500);

      const sheet = this.page.locator(this.selectors.variantSheet);
      if (await sheet.isVisible()) {
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
        await row.locator(this.selectors.stepperAdd).click();
        await this.page.waitForTimeout(1000);
        for (let i = 1; i < quantity; i++) {
          await row.locator(this.selectors.stepperPlus).click();
          await this.page.waitForTimeout(700);
        }
        await sheet.locator(this.selectors.variantSheetClose).click();
        await this.page.waitForTimeout(1000);
      } else {
        // Single-variant: ADD turns into an inline stepper; the same
        // buttonpair-add element is the "+" button.
        for (let i = 1; i < quantity; i++) {
          await card.locator(this.selectors.addToCartButton).click();
          await this.page.waitForTimeout(700);
        }
      }

      return true;
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
      const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);

      // Bill section is plain text: "Item Total | ₹17.00 | ... | To Pay | ₹88".
      const toPay = await this.page.evaluate(() => {
        const lines = document.body.innerText.split('\n').map(l => l.trim());
        const i = lines.indexOf('To Pay');
        return i >= 0 ? lines.slice(i + 1).find(l => l) || '' : '';
      });
      const total = toPay ? this.parsePrice(toPay) : subtotal;

      return {
        platform: this.name,
        items: cartItems,
        subtotal,
        // All fees combined (delivery, handling, small-cart, GST).
        deliveryFee: Math.max(0, total - subtotal),
        total,
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
    await this.page.waitForTimeout(4000);
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
        await row.locator(this.selectors.stepperMinus).click();
        await this.page.waitForTimeout(1500);
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
        const minus = await this.page.$(`${this.selectors.cartItems} ${this.selectors.stepperMinus}`);
        if (!minus) return true;
        await minus.click();
        await this.page.waitForTimeout(1500);
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
    await page.waitForTimeout(4000);
    await page.locator('[data-testid="address-name"]').first().click({ timeout: 8000, force: true });
    const heading = page.getByText('Select from saved address', { exact: true }).first();
    await heading.waitFor({ timeout: 8000 });
    return heading.locator('xpath=../following-sibling::div[1]/div');
  }

  async getOrderPreview(): Promise<any> {
    const cart = await this.getCart();
    if (!cart) return null;

    return {
      cart,
      address: null,
      paymentMethods: ['Wallet', 'UPI', 'Card'],
    };
  }

  async placeOrder(paymentMethod: string): Promise<any> {
    console.log('Place order requires manual confirmation');
    return {
      success: false,
      message: 'Order placement requires manual confirmation for safety',
    };
  }
}
