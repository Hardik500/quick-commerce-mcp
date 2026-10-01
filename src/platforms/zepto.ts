/**
 * Zepto platform implementation
 * URL: https://www.zeptonow.com
 * 
 * NOTE: Zepto uses CloudFront bot detection. For reliable access:
 * 1. Use interactive login mode to save an authenticated session
 * 2. Or use a residential proxy service
 * 
 * Run: npx tsx src/session-helper.ts login zepto
 */
import { BrowserContext, ElementHandle, Page } from 'playwright';
import {
  QuickCommercePlatform,
  Product,
  SearchResult,
  CartSummary,
  CartItem,
  Address,
} from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';

export class ZeptoPlatform extends QuickCommercePlatform {
  // Verified against the live site with an authenticated session
  // (scripts/inspect-selectors.ts inspectZeptoAuthenticated) on 2026-09-28.
  private selectors = {
    searchInput: 'input[role="combobox"]',
    searchResults: 'a[data-testid="product-card"]',
    productName: '[data-slot-id="ProductName"]',
    productPrice: '[data-slot-id="EdlpPrice"]',
    productMRP: '[data-slot-id="Mrp"]',
    addToCartButton: 'button:has-text("ADD")',
    incrementButton: 'button[aria-label="Increase quantity"]',
    decrementButton: 'button[aria-label="Decrease quantity"]',
    cartIcon: '[data-testid="cart"], a[href*="cart"], button[class*="cart"], [class*="CartIcon"]',
    // /cart page structure (scripts/qc-cart-probe.mts style probe on
    // 2026-09-29). Each row is a div wrapping the product link and a
    // per-row stepper whose quantity testid ends in "-cart-qty".
    cartItems: 'div:has(> a[href*="/pvid/"]):has([data-testid$="-cart-qty"])',
    cartItemName: '.__4sxPD',
    cartItemVariant: '.K96_o',
    cartItemQty: '[data-testid$="-cart-qty"]',
    cartItemMinus: '[data-testid$="-minus-btn"]',
    billItemTotal: 'div.flex.justify-between:has(span:text-is("Item Total"))',
    billToPay: 'div.flex.justify-between:has(span:text-is("To Pay"))',
    loginButton: 'button[aria-label="login" i]',
    phoneInput: 'input[type="tel"], input[placeholder*="phone"], input[placeholder*="mobile"], input[placeholder*="number"]',
    otpInput: 'input[aria-label="OTP" i], input[autocomplete="one-time-code"]',
    addressSelector: '[data-testid="user-address"], .address, [class*="AddressCard"]',
    // CloudFront detection
    blockedPage: 'h1:has-text("403"), h2:has-text("Request blocked"), h1:has-text("ERROR")',
  };

  constructor() {
    super('zepto', 'https://www.zeptonow.com');
  }

  async initialize(context: BrowserContext): Promise<void> {
    this.context = context;

    // Session (cookies + localStorage) is restored via storageState when the
    // context is created (see session-helper.ts / index.ts), so nothing to
    // load here.

    this.page = await context.newPage();
    
    // Set viewport to mobile for better compatibility
    await this.page.setViewportSize({ width: 390, height: 844 });
    
    // Add stealth scripts
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Navigate to base URL
    const response = await this.page.goto(this.baseUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Check if blocked by CloudFront
    if (response?.status() === 403) {
      console.error('❌ Zepto returned 403 - CloudFront blocking automated browsers');
      console.error('💡 Tip: Use interactive login mode to save an authenticated session:');
      console.error('   npx tsx src/session-helper.ts login zepto');
    }
    
    // Wait for initial load
    await this.page.waitForTimeout(2000);
    
    // Check for blocked page
    const blockedEl = await this.page.$(this.selectors.blockedPage);
    if (blockedEl) {
      console.error('❌ Zepto blocked the request (bot detection)');
    }
  }

  /** Persist cookies + localStorage so the next run starts already logged in. */
  async saveSession(): Promise<void> {
    if (!this.context) return;

    ensureSessionDir();
    const filePath = sessionPath('zepto');
    await this.context.storageState({ path: filePath });
    console.log('✅ Session saved to', filePath);
  }

  async checkLogin(): Promise<{ loggedIn: boolean; otpSent?: boolean; phone?: string }> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // The login button only appears after the SPA hydrates, so a check
      // performed too early would falsely report "logged in".
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // CloudFront/WAF block pages have no login UI either - detect them
      // explicitly so they aren't mistaken for a logged-in state.
      const blockedEl = await this.page.$(this.selectors.blockedPage);
      if (blockedEl) {
        console.error('❌ Zepto blocked the request (bot detection) - cannot determine login state');
        this.isLoggedIn = false;
        return { loggedIn: false };
      }

      const loginButton = await this.page.$(this.selectors.loginButton);
      if (!loginButton) {
        this.isLoggedIn = true;
        return { loggedIn: true };
      }

      const cookies = await this.context!.cookies();
      const sessionCookie = cookies.find(c => c.name.includes('session') || c.name.includes('token'));
      if (sessionCookie && sessionCookie.expires && sessionCookie.expires > Date.now() / 1000) {
        this.isLoggedIn = true;
        return { loggedIn: true };
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
      // Find and fill OTP input
      const otpInput = await this.page.$(this.selectors.otpInput);
      if (!otpInput) {
        console.log('OTP input not found');
        return false;
      }

      await otpInput.fill(otp);
      
      // Find and click verify button
      const verifyButton = await this.page.$('button:has-text("Verify"), button:has-text("Submit")');
      if (verifyButton) {
        await verifyButton.click();
        await this.page.waitForTimeout(3000);
      }

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

  async search(query: string, location?: string): Promise<SearchResult> {
    if (!this.page) throw new Error('Platform not initialized');
    if (!this.isLoggedIn) {
      throw new Error('Not logged in. Please login first.');
    }

    try {
      // Typing into the bare /search page can leave its "trending" cards on
      // screen; the query URL renders only the real results.
      await this.page.goto(`${this.baseUrl}/search?query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForSelector(this.selectors.searchResults, { timeout: 10000 }).catch(() => {});

      // Extract products
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

      for (const element of productElements.slice(0, 20)) { // Limit to first 20
        try {
          const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
          const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
          const price = this.parsePrice(priceText);
          
          // Try to get MRP if available
          let mrp: number | undefined;
          try {
            const mrpText = await element.$eval(this.selectors.productMRP, el => el.textContent?.trim());
            mrp = this.parsePrice(mrpText || '');
          } catch {
            mrp = undefined;
          }

          // Product cards all share data-testid="product-card"; the unique
          // ID lives in the "pvid" segment of the card's link href instead.
          const productId = await element.evaluate(el => {
            const href = el.getAttribute('href') || '';
            const match = href.match(/\/pvid\/([^/?]+)/);
            return match ? match[1] : Math.random().toString(36).substring(7);
          });

          products.push({
            id: productId,
            name: name || 'Unknown Product',
            price,
            mrp,
            quantity: await this.extractCardQuantity(element, name),
            platform: this.name,
            inStock: true, // Assume in stock if visible
          });
        } catch {
          // Skip products that fail extraction
        }
      }
    } catch (error) {
      console.error('Error extracting products:', error);
    }

    return products;
  }

  // Pack size ("1 pack (250 ml)") is the card line right after the name.
  private async extractCardQuantity(card: ElementHandle, name: string): Promise<string> {
    const lines = (await card.innerText()).split('\n').map(l => l.trim());
    const i = lines.indexOf(name);
    return i >= 0 && lines[i + 1] ? lines[i + 1] : this.extractQuantity(name);
  }

  private extractQuantity(name: string): string {
    // Try to extract quantity from product name like "Coke Zero 300ml", "Milk 1L"
    const match = name.match(/(\d+\s*(?:ml|L|g|kg|pcs|pack))/i);
    return match ? match[1] : '1 unit';
  }

  async addToCart(productId: string, quantity: number): Promise<boolean> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      // Product cards all share data-testid="product-card"; find the one
      // whose href contains the pvid we extracted during search.
      const product = await this.page.$(`${this.selectors.searchResults}[href*="/pvid/${productId}"]`);
      if (!product) {
        console.log('Product not found:', productId);
        return false;
      }

      const addButton = await product.$(this.selectors.addToCartButton);
      if (!addButton) {
        console.log('Add to cart button not found');
        return false;
      }

      await addButton.click();
      await this.page.waitForTimeout(1000);

      // Handle quantity if > 1
      if (quantity > 1) {
        for (let i = 1; i < quantity; i++) {
          const incrementButton = await product.$(this.selectors.incrementButton);
          if (incrementButton) {
            await incrementButton.click();
            await this.page.waitForTimeout(500);
          }
        }
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
    await this.page.waitForTimeout(3000);
  }

  // Bill rows can hold a strikethrough original price alongside the final
  // one (e.g. "₹229 ₹184"); take the last ₹ amount as the actual value.
  private lastPrice(text: string): number {
    const matches = [...text.matchAll(/₹\s*[\d,.]+/g)];
    return matches.length ? this.parsePrice(matches[matches.length - 1][0]) : 0;
  }

  async getCart(): Promise<CartSummary | null> {
    if (!this.page) throw new Error('Platform not initialized');

    try {
      await this.openCart();
      const cartItems = await this.extractCartItems();

      const itemTotalText = await this.page.locator(this.selectors.billItemTotal).first().textContent().catch(() => null);
      const toPayText = await this.page.locator(this.selectors.billToPay).first().textContent().catch(() => null);
      const subtotal = itemTotalText ? this.lastPrice(itemTotalText) : cartItems.reduce((sum, item) => sum + item.price * item.cartQuantity, 0);
      const total = toPayText ? this.lastPrice(toPayText) : subtotal;

      return {
        platform: this.name,
        items: cartItems,
        subtotal,
        deliveryFee: total - subtotal,
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
          const variant = await element.$eval(this.selectors.cartItemVariant, el => el.textContent?.trim() || '1 unit').catch(() => '1 unit');
          const cartQuantity = await element.$eval(this.selectors.cartItemQty, el => parseInt(el.textContent?.trim() || '1', 10) || 1);
          const priceText = await element.evaluate(el => el.textContent || '');
          // Zepto shows the row's line total (price × cartQuantity), not the
          // unit price, so divide it back out to match the Product contract.
          const price = this.lastPrice(priceText) / cartQuantity;

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
        if ((await row.count()) === 0) return i > 0;
        await row.locator(this.selectors.cartItemMinus).click();
        await this.page.waitForTimeout(1000);
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
        const minus = await this.page.$(`${this.selectors.cartItems} ${this.selectors.cartItemMinus}`);
        if (!minus) return true;
        await minus.click();
        await this.page.waitForTimeout(1000);
      }
      return false;
    } catch (error) {
      console.error('Error clearing cart:', error);
      return false;
    }
  }

  async getAddresses(): Promise<Address[]> {
    // Would navigate to address page and extract addresses
    console.log('Get addresses not yet implemented');
    return [];
  }

  async selectAddress(addressId: string): Promise<boolean> {
    console.log('Select address not yet implemented');
    return false;
  }

  async getOrderPreview(): Promise<any> {
    const cart = await this.getCart();
    if (!cart) return null;

    return {
      cart,
      address: null, // Would extract from page
      paymentMethods: ['Wallet', 'UPI', 'Card'],
    };
  }

  async placeOrder(paymentMethod: string): Promise<any> {
    console.log('Place order not yet implemented - requires user confirmation');
    return {
      success: false,
      message: 'Order placement requires manual confirmation for safety',
    };
  }
}
