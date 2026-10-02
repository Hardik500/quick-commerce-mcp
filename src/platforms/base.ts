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

/**
 * What a login check concluded.
 *
 * `indeterminate` exists because "not logged in" and "could not find out" lead
 * to opposite advice. Collapsing them sends the user off to re-login when their
 * session is perfectly valid, which is worse than saying nothing: a re-login
 * costs an OTP round trip and, on a bot-blocked page, cannot succeed anyway.
 */
export interface LoginStatus {
  loggedIn: boolean;
  otpSent?: boolean;
  phone?: string;
  /** A block page, a timeout or any other error meant this is not a real "no". */
  indeterminate?: boolean;
  /** Human-readable cause, shown when `indeterminate` is set. */
  reason?: string;
}

export abstract class QuickCommercePlatform {
  protected name: string;
  protected baseUrl: string;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected isLoggedIn: boolean = false;
  /**
   * Whether `isLoggedIn` reflects a check this instance actually performed.
   *
   * Without it, `isLoggedIn` is only true if some earlier caller happened to
   * remember to call `checkLogin()`, so any new code path that reaches a guarded
   * method without doing so fails on a valid session. That already cost one bug:
   * `add_to_cart` on Instamart skipped the check, the internal `search()` threw
   * "Not logged in", and a `.catch(() => null)` turned it into "Product not
   * found". Tracked separately so `ensureSession` can verify lazily instead.
   *
   * `ensureSession` maintains this itself rather than trusting each `checkLogin`
   * to - otherwise the next platform added would have to remember, which is the
   * same trap in a new place.
   */
  protected sessionVerified: boolean = false;

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
  abstract checkLogin(): Promise<LoginStatus>;

  /**
   * Confirm there is a usable session, checking lazily if nobody has yet.
   *
   * Call this instead of reading `isLoggedIn` directly. It removes the trap where
   * a method throws "Not logged in" on a perfectly good session simply because
   * the caller was the first to touch the platform this instance.
   *
   * The check runs at most once per successful verification, so a normal tool
   * call still costs one cookie read, not one per guarded method. A failed check
   * is not remembered, so a transient failure does not poison the instance.
   */
  protected async ensureSession(): Promise<void> {
    if (this.sessionVerified && this.isLoggedIn) return;
    const status = await this.checkLogin();
    if (status.loggedIn) {
      this.isLoggedIn = true;
      this.sessionVerified = true;
      return;
    }
    // Only a definite "no" counts as verified. Anything else leaves the instance
    // unverified so the next call tries again instead of replaying this result.
    this.sessionVerified = false;
    if (status.indeterminate) {
      throw new Error(
        `Could not confirm the ${this.name} session: ${status.reason ?? 'the page did not load as expected'}. ` +
          `This is usually a bot check or a slow page, not a logged-out account - retry in a few seconds before asking the user to log in again.`,
      );
    }
    throw new Error('Not logged in. Please login first.');
  }

  /** Enter the phone number and request an OTP. Override per platform. */
  async sendOtp(_phone: string): Promise<boolean> {
    throw new Error('Not supported for this platform. Run `npx -y -p quick-commerce-mcp quick-commerce-mcp-login <platform>` instead.');
  }

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
  async selectAddress(addressId: string, retried = false): Promise<boolean> {
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
      // Picker clicks are flaky on the mobile viewport ("outside of the viewport"); retry once.
      if (!retried) return this.selectAddress(addressId, true);
      console.error('Error selecting address:', error);
      return false;
    }
  }

  /**
   * Get final order preview (before payment)
   */
  abstract getOrderPreview(): Promise<OrderPreview | null>;

  /** Text of the most recent order (status, items, total), or null if unsupported/none. */
  async getLatestOrder(): Promise<string | null> { return null; }

  /**
   * Put the page into the state where `step`'s element should exist, so a broken
   * flow can be inspected rather than only reported. Override per platform; the
   * default does nothing for steps that live on a page already loaded.
   */
  async prepareForStep(_step: string): Promise<void> {}


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
