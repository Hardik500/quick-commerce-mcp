/**
 * Swiggy Instamart implementation
 * URL: https://www.swiggy.com/instamart
 */
import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary } from './base.js';
export declare class SwiggyInstamartPlatform extends QuickCommercePlatform {
    private selectors;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
    private handleLocationPopup;
    checkLogin(): Promise<{
        loggedIn: boolean;
        otpSent?: boolean;
        phone?: string;
    }>;
    submitOtp(otp: string): Promise<boolean>;
    /** Persist cookies + localStorage so the next run starts already logged in. */
    saveSession(): Promise<void>;
    search(query: string): Promise<SearchResult>;
    private extractProductResults;
    private extractQuantity;
    addToCart(productId: string, quantity: number): Promise<boolean>;
    getCart(): Promise<CartSummary | null>;
    private extractCartItems;
    private openCart;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    protected openAddressPicker(): Promise<Locator>;
    getOrderPreview(): Promise<any>;
    placeOrder(paymentMethod: string): Promise<any>;
}
//# sourceMappingURL=swiggy-instamart.d.ts.map