/**
 * Base platform interface for quick commerce automation
 * All platform implementations (Zepto, Swiggy, etc.) extend this
 */
import { BrowserContext, Locator, Page } from 'playwright';
import { AddOutcome } from '../engine/add-strategy.js';
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
    fees?: {
        label: string;
        amount: number;
    }[];
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
export declare abstract class QuickCommercePlatform {
    protected name: string;
    protected baseUrl: string;
    protected context: BrowserContext | null;
    protected page: Page | null;
    protected isLoggedIn: boolean;
    private productQueries;
    /** Keep IDs usable after cart/address reads navigate away from search. */
    protected rememberSearch(query: string, products: Product[]): void;
    /** The name needed to validate ID-only requests against name-based cart rows. */
    getProductName(productId: string): string | undefined;
    protected restoreProductSearch(productId: string): Promise<void>;
    /**
     * Why the last add failed, when the cause is something other than a missing
     * button - e.g. "div#cookie-banner ... is covering it". Null when the add
     * worked, or when it failed for want of a control. Read it immediately after
     * `addToCart` returns 'failed'; it is overwritten by the next attempt.
     */
    lastAddBlocker: string | null;
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
    protected sessionVerified: boolean;
    constructor(name: string, baseUrl: string);
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
    protected ensureSession(): Promise<void>;
    /** Enter the phone number and request an OTP. Override per platform. */
    sendOtp(_phone: string): Promise<boolean>;
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
    private addressCache?;
    getAddresses(): Promise<Address[]>;
    /**
     * Run a UI action (click) and wait until the page text changes, instead of
     * sleeping a fixed time. Resolves anyway on timeout (action may be a no-op).
     */
    protected afterChange(action: () => Promise<unknown>, timeout?: number): Promise<void>;
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
    protected addViaCard(card: Locator, spec: {
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
    }, quantity?: number): Promise<AddOutcome>;
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
    private topUp;
    /**
     * Select delivery address by id from getAddresses().
     */
    selectAddress(addressId: string, retried?: boolean): Promise<boolean>;
    /**
     * Get final order preview (before payment)
     */
    abstract getOrderPreview(): Promise<OrderPreview | null>;
    /** Text of the most recent order (status, items, total), or null if unsupported/none. */
    getLatestOrder(): Promise<string | null>;
    /**
     * Put the page into the state where `step`'s element should exist, so a broken
     * flow can be inspected rather than only reported. Override per platform; the
     * default does nothing for steps that live on a page already loaded.
     */
    prepareForStep(_step: string): Promise<void>;
    /** Known payment option labels, matched against the payment screen text. */
    private static readonly PAYMENT_LABELS;
    protected scanPaymentMethods(text: string): string[];
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
        image?: Buffer;
        message: string;
    }>;
    /**
     * Close browser context
     */
    close(): Promise<void>;
    getName(): string;
    /** Extract numeric value from price text like "₹45", "Rs. 45", "45.00". */
    protected parsePrice(priceText: string): number;
    isAuthenticated(): boolean;
}
//# sourceMappingURL=base.d.ts.map