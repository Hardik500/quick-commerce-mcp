/**
 * Base platform interface for quick commerce automation
 * All platform implementations (Zepto, Swiggy, etc.) extend this
 */
import { BrowserContext, Locator, Page } from 'playwright';
import { pick } from '../flows.js';
import { AddOutcome, blockedBy, nextAddAction } from '../engine/add-strategy.js';
import { loadPrefs, savePrefs, preferredAddress } from '../preferences.js';
import { inspectPayments, preparePaymentPanel } from '../payment-ui.js';
import type { PaymentPreferences } from '../payments.js';
import { inspectWallet, inspectWallets, WalletCheckout, type WalletOrderResult } from '../wallet.js';
import { sessionPath } from '../session-helper.js';
import { PaymentTracker } from '../payment-tracking.js';

/**
 * How long to wait for a dispatched click to show up on the card.
 *
 * Longer than the click budgets it replaces, because after a dispatched click
 * there is no retry available (see addViaCard), so patience costs nothing and a
 * slow store is the common case rather than an edge case.
 */
const PROOF_AFTER_CLICK_MS = 8000;

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
  /** Informational caveat; unlike notice, this does not block checkout. */
  information?: string;
}

export interface SearchResult {
  query: string;
  platform: string;
  products: Product[];
  totalResults: number;
  error?: string;
  /** Limited native suggestion results are not an exhaustive catalog search. */
  information?: string;
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
  private walletCheckout: WalletCheckout;
  private paymentTracker: PaymentTracker;
  private productQueries = new Map<string, { query: string; name: string }>();

  /** Keep IDs usable after cart/address reads navigate away from search. */
  protected rememberSearch(query: string, products: Product[]): void {
    for (const product of products) this.productQueries.set(product.id, { query, name: product.name });
  }

  /** The name needed to validate ID-only requests against name-based cart rows. */
  getProductName(productId: string): string | undefined {
    return this.productQueries.get(productId)?.name;
  }

  protected async restoreProductSearch(productId: string): Promise<void> {
    const query = this.productQueries.get(productId)?.query;
    if (query) await this.search(query);
  }

  /**
   * Why the last add failed, when the cause is something other than a missing
   * button - e.g. "div#cookie-banner ... is covering it". Null when the add
   * worked, or when it failed for want of a control. Read it immediately after
   * `addToCart` returns 'failed'; it is overwritten by the next attempt.
   */
  lastAddBlocker: string | null = null;
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
    this.walletCheckout = new WalletCheckout(sessionPath(name).replace('-session.json', '-wallet-attempt.json'));
    this.paymentTracker = new PaymentTracker(sessionPath(name).replace('-session.json', '-payment-tracking.json'), sessionPath(name).replace('-session.json', '-wallet-attempt.json'));
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
   * Add product to cart.
   *
   * Returns a classified outcome rather than a boolean, because the caller has
   * to act differently on each: 'already' is a success, and 'absent' means the
   * page never offered a control to click, which is worth stopping a whole
   * batch for instead of repeating the same doomed lookup per item.
   */
  abstract addToCart(productId: string, quantity: number): Promise<AddOutcome>;

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
   * Put `quantity` of the product on `card` into the cart, and prove it.
   *
   * This is the one operation every platform does the same way, and it is the
   * one that used to be slowest: a single hardcoded add-button selector, and a
   * click with no timeout of its own, so Playwright's 30s default applied and
   * "element is not visible" was spent in full before giving up. With a
   * multi-item cart that is 30s per item and no items added.
   *
   * Instead the click is bounded and escalated, and the outcome is a classified
   * fact rather than a boolean. Each selector is resolved through the flow
   * layer, so a `diagnose_flow` override for `addToCart`, `cartLanded` or
   * `cartIncrement` takes effect here with no code change and no release.
   *
   * Waiting is fine; waiting to no purpose is not. Every rung either recovers
   * the click or proves the item is in the cart, and the whole ladder is
   * bounded by ADD_RUNGS.
   */
  protected async addViaCard(
    card: Locator,
    spec: {
      /** Ordered candidates for "this item is in the cart" (the stepper). */
      landed: readonly string[];
      /** Ordered candidates for the add control, best first. */
      add: readonly string[];
      /** Ordered candidates for the increment control. */
      increment: readonly string[];
      /**
       * Runs after the first successful click and before the landed-proof is
       * read, for platforms where clicking opens something that must then be
       * filled in (a variant sheet). Returning true means the hook completed
       * the add and proved it itself; returning false hands the proof back to
       * the normal path.
       */
      between?: (card: Locator) => Promise<boolean>;
    },
    quantity = 1,
  ): Promise<AddOutcome> {
    let rung = 0;
    let scrolled = false;
    let waitedForAttach = false;
    // The most recently resolved add control, kept so the failure path can ask
    // what was covering it after the loop has gone out of scope.
    let lastAdd: Locator | null = null;
    // Set only when the ladder ran out of rungs, so the caller can be told what
    // was actually in the way rather than just that it failed.
    this.lastAddBlocker = null;

    // Bounded by construction: every branch either returns or advances the
    // ladder, and the ladder is finite. The step cap is a backstop, not the
    // mechanism that terminates.
    for (let step = 0; step < 8; step++) {
      const landed = await pick(card, this.name, 'cartLanded', [...spec.landed]);
      const add = await pick(card, this.name, 'addToCart', [...spec.add]);
      if (add) lastAdd = add.locator;
      const landedVisible = landed ? await landed.locator.isVisible().catch(() => false) : false;
      const addVisible = add ? await add.locator.isVisible().catch(() => false) : false;

      const action = nextAddAction({ landed: landedVisible, addPresent: !!add, addVisible, rung, scrolled, waitedForAttach });

      switch (action.kind) {
        case 'already':
          return 'already';
        case 'absent':
          return 'absent';
        case 'failed':
          // Out of rungs with the item still not in the cart. Say what is in
          // the way, because "could not be clicked" is not something a caller
          // can act on while "a cookie banner is covering it" is. One bounded
          // DOM read, on the failure path only.
          if (lastAdd) this.lastAddBlocker = await blockedBy(lastAdd);
          return 'failed';
        case 'wait-attach':
          // A virtualised results list renders cards after the query settles.
          waitedForAttach = true;
          await pick(card, this.name, 'addToCart', [...spec.add], 4000);
          break;

        case 'scroll':
          // Cheapest possible fix for the most common cause: a control that
          // exists but sits outside the mobile viewport.
          scrolled = true;
          await add?.locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
          break;

        case 'click': {
          if (!add) return 'absent';
          const clicked = await add.locator.click({ timeout: action.timeout, force: action.force }).then(() => true, () => false);
          if (!clicked) {
            // Playwright refused to dispatch the click - not visible, outside the
            // viewport, or covered. Nothing reached the site, so trying the next
            // rung cannot duplicate anything.
            rung++;
            break;
          }

          // The click WAS dispatched, so the site may already have added the
          // item. Clicking this card again is therefore not a retry, it is a
          // second add - and this used to be exactly what happened: with a
          // closed store the quantity counter never renders, so the proof below
          // always failed, the ladder escalated, and every rung added another
          // unit. Asking for 3 put 5 in the cart while reporting a failure.
          //
          // So there is no second click on this card, whatever happens next.
          // Not being able to retry makes waiting free, so the proof gets a
          // longer budget than a retry would have been worth.
          if (spec.between && (await spec.between(card))) return 'added';
          const proof = await pick(card, this.name, 'cartLanded', [...spec.landed], PROOF_AFTER_CLICK_MS);
          if (!proof || !(await proof.locator.waitFor({ state: 'visible', timeout: PROOF_AFTER_CLICK_MS }).then(() => true, () => false))) {
            // Unproven, but the click landed and may yet be reflected in the
            // cart. Say so rather than claiming a failure the read-back will
            // contradict; the caller's cart read is the authority here.
            this.lastAddBlocker = 'the click was sent but the item has not appeared on the card; it may or may not be in the cart - check get_cart_summary before retrying, retrying could duplicate it';
            return 'failed';
          }
          await this.topUp(card, spec.increment, quantity);
          return 'added';
        }
      }
    }
    return 'failed';
  }

  /**
   * Raise an already-added item to `quantity`, one press at a time. The stepper
   * is re-resolved before every press because it re-renders on each one, so a
   * handle taken once would go stale and the second press would land nowhere.
   *
   * The short press budget is deliberate: reaching here means the stepper was
   * just observed on the card, so it is present and interactive, and a press
   * that cannot land in 3s is not going to land in 30. Without that bound a
   * broken stepper would cost 10s per remaining unit - the same trap as the
   * click this replaced, one level down.
   *
   * A press that cannot be completed leaves the single unit in the cart and
   * stops. The caller reports the shortfall from the cart read-back, which
   * re-counts what is actually there rather than trusting the click.
   */
  private async topUp(card: Locator, increment: readonly string[], quantity: number): Promise<void> {
    for (let i = 1; i < quantity; i++) {
      const press = async (): Promise<boolean> => {
        const plus = await pick(card, this.name, 'cartIncrement', [...increment]);
        if (!plus) return false;
        return plus.locator.click({ timeout: 3000 }).then(() => true, () => false);
      };
      if (!(await press()) && !(await press())) return;
      // Let the counter settle before the next press.
      await this.page?.waitForTimeout(300).catch(() => {});
    }
  }

  /**
   * Select delivery address by id from getAddresses().
   */
  async selectAddress(addressId: string, retried = false): Promise<boolean> {
    if (!this.page) return false;
    try {
      const target = (await this.getAddresses()).find(a => a.id === addressId);
      if (!target) return false;
      const cards = await this.openAddressPicker();
      // Match by text, not position: card order changes with the current location.
      const card = cards.filter({ hasText: target.addressLine1.split(',')[0] }).filter({ hasText: target.label }).first();
      if ((await card.count()) === 0) return false;
      await card.click();
      // Picker closes once the address is applied.
      await cards.first().waitFor({ state: 'hidden', timeout: 10000 });
      this.rememberAddress(target);
      return true;
    } catch (error) {
      // Picker clicks are flaky on the mobile viewport ("outside of the viewport"); retry once.
      if (!retried) return this.selectAddress(addressId, true);
      console.error('Error selecting address:', error);
      return false;
    }
  }

  protected rememberAddress(address: Address): void {
    const prefs = loadPrefs();
    savePrefs({ selected_addresses: { ...prefs.selected_addresses,
      [this.name]: { label: address.label, addressLine1: address.addressLine1, pincode: address.pincode },
    } });
  }

  /** Reuse a confirmed choice, or select the sole saved address for this area.
   * Ambiguous or missing matches stay visible to the caller for a user choice. */
  async resolveDeliveryAddress(): Promise<{ addresses: Address[]; selected?: Address }> {
    const addresses = await this.getAddresses();
    const prefs = loadPrefs();
    const target = preferredAddress(addresses, prefs.pincode, prefs.selected_addresses?.[this.name]);
    if (target && await this.selectAddress(target.id)) return { addresses, selected: target };
    return { addresses };
  }

  /**
   * Get final order preview (before payment)
   */
  abstract getOrderPreview(): Promise<OrderPreview | null>;

  async getPaymentOptions() {
    const preview = await this.getOrderPreview();
    if (!preview || !this.page) throw new Error('Checkout unavailable. Resolve cart, login and address before choosing payment.');
    const options = await inspectPayments(this.page, this.name, preview.paymentMethods);
    const wallet = await inspectWallet(this.page, this.name, preview.cart.total);
    if (wallet.provider) options.push({ id: `wallet:native:${wallet.provider.toLowerCase()}`, method: 'wallet', label: wallet.provider,
      enabled: wallet.status === 'ready', execution: wallet.status === 'ready' ? 'adapter' : 'manual', balanceVerifiedWallet: true });
    return { preview, options, wallet };
  }

  async getWalletStatus(provider?: string) {
    const preview = await this.getOrderPreview();
    if (!preview || !this.page) throw new Error('Checkout unavailable. Resolve cart, login and address first.');
    await preparePaymentPanel(this.page, this.name, preview.paymentMethods, { order: ['wallet'], wallet_provider: provider });
    const wallet = await inspectWallet(this.page, this.name, preview.cart.total, provider);
    return { preview, wallet, wallets: await inspectWallets(this.page, this.name, preview.cart.total) };
  }

  async placeWalletOrder(confirm = false, provider?: string): Promise<WalletOrderResult> {
    const { preview } = await this.getWalletStatus(provider);
    if (!this.page) return { success: false, message: 'Checkout unavailable; no wallet payment attempted.' };
    return confirm ? this.walletCheckout.submit(this.page, this.name, preview, provider) : this.walletCheckout.prepare(this.page, this.name, preview, provider);
  }

  async preparePayment(preferences: PaymentPreferences, optionId?: string) {
    const preview = await this.getOrderPreview();
    if (!preview || !this.page) throw new Error('Checkout unavailable. Resolve cart, login and address before preparing payment.');
    return { preview, ...await preparePaymentPanel(this.page, this.name, preview.paymentMethods, preferences, optionId) };
  }

  /** Text of the most recent order (status, items, total), or null if unsupported/none. */
  async getLatestOrder(): Promise<string | null> { return null; }

  async beginPaymentTracking(method: string, total: number) {
    await this.paymentTracker.begin(this.name, method, total, this.context?.pages() ?? []);
  }
  abandonUnsubmittedPayment() { this.paymentTracker.abandonUnsubmitted(); }
  async getPaymentStatus(waitMs = 0) { return this.paymentTracker.inspect(() => this.context?.pages() ?? [], waitMs); }

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
    'Add New Card', 'Add credit or debit cards', 'Credit/Debit Card', 'Cards', 'Wallets',
    'Navi', 'Pay via QR Code', 'Pay Later', 'UPI', 'Enter UPI ID',
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
    submitted?: boolean;
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
