/**
 * Base platform interface for quick commerce automation
 * All platform implementations (Zepto, Swiggy, etc.) extend this
 */
import { BrowserContext, Page } from 'playwright';
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
    /**
     * Submit OTP and complete login
     */
    abstract submitOtp(otp: string): Promise<boolean>;
    /**
     * Search for products
     */
    abstract search(query: string, location?: string): Promise<SearchResult>;
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
     * Get available addresses
     */
    abstract getAddresses(): Promise<Address[]>;
    /**
     * Select delivery address
     */
    abstract selectAddress(addressId: string): Promise<boolean>;
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
    close(): Promise<void>;
    getName(): string;
    isAuthenticated(): boolean;
}
//# sourceMappingURL=base.d.ts.map