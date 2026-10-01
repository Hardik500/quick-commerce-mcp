/**
 * Base platform interface for quick commerce automation
 * All platform implementations (Zepto, Swiggy, etc.) extend this
 */
import { BrowserContext, Locator, Page } from 'playwright';

export interface Product {
  id: string;
  name: string;
  brand?: string;
  price: number;
  mrp?: number;
  discount?: string;
  quantity: string;
  imageUrl?: string;
  inStock: boolean;
  deliveryTime?: string;
  platform: string;
}

export interface CartItem extends Product {
  cartQuantity: number;
}

export interface CartSummary {
  platform: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliverySlot?: string;
}

export interface SearchResult {
  query: string;
  platform: string;
  products: Product[];
  totalResults: number;
  error?: string;
}

export interface Address {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  pincode: string;
  phone: string;
}

export abstract class QuickCommercePlatform {
  protected name: string;
  protected baseUrl: string;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected isLoggedIn: boolean = false;

  constructor(name: string, baseUrl: string) {
    this.name = name;
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize browser context
   */
  abstract initialize(context: BrowserContext): Promise<void>;

  /**
   * Check if user is logged in, prompt for OTP if needed
   * Returns: true if logged in, false if OTP needed
   */
  abstract checkLogin(): Promise<{ loggedIn: boolean; otpSent?: boolean; phone?: string }>;

  /**
   * Submit OTP and complete login
   */
  abstract submitOtp(otp: string): Promise<boolean>;

  /**
   * Search for products
   */
  abstract search(query: string): Promise<SearchResult>;

  /**
   * Add product to cart
   */
  abstract addToCart(productId: string, quantity: number): Promise<boolean>;

  /**
   * Get current cart contents
   */
  abstract getCart(): Promise<CartSummary | null>;

  /**
   * Remove item from cart
   */
  abstract removeFromCart(productId: string): Promise<boolean>;

  /**
   * Clear cart
   */
  abstract clearCart(): Promise<boolean>;

  /**
   * Open the site's address picker and return a locator for the saved-address cards.
   */
  protected abstract openAddressPicker(): Promise<Locator>;

  /**
   * Get saved addresses. `id` is the card's position in the picker.
   */
  async getAddresses(): Promise<Address[]> {
    if (!this.page) return [];
    try {
      const cards = await this.openAddressPicker();
      const texts = await cards.allInnerTexts();
      await this.page.keyboard.press('Escape');
      return texts.map((t, i) => {
        const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
        const line1 = lines.slice(1).join(', ');
        return {
          id: String(i),
          label: lines[0] || '',
          addressLine1: line1,
          city: '',
          pincode: line1.match(/\b\d{6}\b/)?.[0] || '',
          phone: '',
        };
      });
    } catch (error) {
      console.error('Error getting addresses:', error);
      return [];
    }
  }

  /**
   * Run a UI action (click) and wait until the page text changes, instead of
   * sleeping a fixed time. Resolves anyway on timeout (action may be a no-op).
   */
  protected async afterChange(action: () => Promise<unknown>, timeout = 5000): Promise<void> {
    const page = this.page!;
    const before = await page.evaluate(() => document.body.innerText);
    await action();
    await page
      .waitForFunction((b) => document.body.innerText !== b, before, { timeout })
      .catch(() => {});
  }

  /**
   * Select delivery address by id from getAddresses().
   */
  async selectAddress(addressId: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const cards = await this.openAddressPicker();
      if (Number(addressId) >= (await cards.count())) return false;
      await cards.nth(Number(addressId)).click();
      // Picker closes once the address is applied.
      await cards.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      return true;
    } catch (error) {
      console.error('Error selecting address:', error);
      return false;
    }
  }

  /**
   * Get final order preview (before payment)
   */
  abstract getOrderPreview(): Promise<{
    cart: CartSummary;
    address: Address;
    paymentMethods: string[];
    walletBalance?: number;
  } | null>;

  /**
   * Place order (requires explicit confirmation)
   */
  abstract placeOrder(paymentMethod: string): Promise<{
    success: boolean;
    orderId?: string;
    message: string;
  }>;

  /**
   * Close browser context
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
    }
    this.context = null;
    this.page = null;
  }

  getName(): string {
    return this.name;
  }

  /** Extract numeric value from price text like "₹45", "Rs. 45", "45.00". */
  protected parsePrice(priceText: string): number {
    const match = priceText.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/);
    return match ? parseFloat(match[1]) : 0;
  }

  isAuthenticated(): boolean {
    return this.isLoggedIn;
  }
}
