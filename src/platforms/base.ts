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
  /** Itemised charges beyond the items total (delivery, handling, small cart, ...). */
  fees?: { label: string; amount: number }[];
  total: number;
  deliverySlot?: string;
  /** Store closed / unserviceable banner, when the platform shows one. */
  notice?: string;
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

export interface OrderPreview {
  cart: CartSummary;
  /** Delivery address text as shown at checkout. */
  address: string;
  /** Payment options visible on the platform's payment screen. */
  paymentMethods: string[];
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
  // The picker may reorder cards by distance from the current location, so the
  // first listing is cached to keep ids stable. ponytail: restart to pick up new addresses.
  private addressCache?: Address[];

  async getAddresses(): Promise<Address[]> {
    if (!this.page) return [];
    if (this.addressCache) return this.addressCache;
    try {
      const cards = await this.openAddressPicker();
      const texts = await cards.allInnerTexts();
      await this.page.keyboard.press('Escape');
      return (this.addressCache = texts.map((t, i) => {
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
      }));
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
      const target = (await this.getAddresses())[Number(addressId)];
      if (!target) return false;
      const cards = await this.openAddressPicker();
      // Match by text, not position: card order changes with the current location.
      const card = cards.filter({ hasText: target.addressLine1.split(',')[0] }).filter({ hasText: target.label }).first();
      if ((await card.count()) === 0) return false;
      await card.click();
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
  abstract getOrderPreview(): Promise<OrderPreview | null>;

  /** Known payment option labels, matched against the payment screen text. */
  private static readonly PAYMENT_LABELS = [
    'Google Pay', 'GPay', 'PhonePe', 'Paytm', 'BHIM', 'CRED', 'Amazon Pay', 'Mobikwik',
    'LazyPay', 'Pluxee', 'Netbanking', 'Net Banking', 'Cash on Delivery', 'Pay on Delivery',
    'Add New Card', 'Add credit or debit cards', 'Navi', 'Pay via QR Code', 'Pay Later', 'UPI',
  ];

  protected scanPaymentMethods(text: string): string[] {
    // "Cash on delivery is not available for orders below ₹50" is not an option.
    text = text.replace(/cash on delivery is not available[^\n]*/gi, '');
    const lower = text.toLowerCase();
    const labels = QuickCommercePlatform.PAYMENT_LABELS.filter(l => lower.includes(l.toLowerCase()));
    // Saved cards render as "HDFC Credit Card\n**** 9292" / "Hsbc Mastercard Card\n****** 8023".
    const cards = [...text.matchAll(/([A-Za-z][A-Za-z ]*? Card)\s*\*{2,6}\s*(\d{4})/g)]
      .map(m => `${m[1].trim()} ••${m[2]}`);
    return [...new Set([...labels, ...cards])];
  }

  /**
   * Place order in two steps. confirm=false selects the payment method and stops
   * before the final click (ready=true, total set). confirm=true performs the
   * final click, only if a prior confirm=false left the checkout armed.
   */
  abstract placeOrder(paymentMethod: string, confirm?: boolean, upiId?: string): Promise<{
    success: boolean;
    ready?: boolean;
    total?: number;
    orderId?: string;
    image?: Buffer; // e.g. a UPI QR the user must scan
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
