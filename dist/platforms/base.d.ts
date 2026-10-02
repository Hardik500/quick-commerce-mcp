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
export declare abstract class QuickCommercePlatform {
    protected name: string;
    protected baseUrl: string;
    protected context: BrowserContext | null;
    protected page: Page | null;
    protected isLoggedIn: boolean;
    constructor(name: string, baseUrl: string);
    /**
     * Initialize browser context
     */
    abstract initialize(context: BrowserContext): Promise<void>;
    /**
     * Check if user is logged in, prompt for OTP if needed
     * Returns: true if logged in, false if OTP needed
     */
    abstract checkLogin(): Promise<{
        loggedIn: boolean;
        otpSent?: boolean;
        phone?: string;
    }>;
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
    private addressCache?;
    getAddresses(): Promise<Address[]>;
    /**
     * Run a UI action (click) and wait until the page text changes, instead of
     * sleeping a fixed time. Resolves anyway on timeout (action may be a no-op).
     */
    protected afterChange(action: () => Promise<unknown>, timeout?: number): Promise<void>;
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