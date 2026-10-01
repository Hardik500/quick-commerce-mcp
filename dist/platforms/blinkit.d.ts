/**
 * Blinkit (formerly Grofers) platform implementation
 * URL: https://blinkit.com
 */
import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary } from './base.js';
export declare class BlinkitPlatform extends QuickCommercePlatform {
    private selectors;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
    private handleInitialPopups;
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
    private openCart;
    getCart(): Promise<CartSummary | null>;
    private extractCartItems;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    protected openAddressPicker(): Promise<Locator>;
    getOrderPreview(): Promise<any>;
    placeOrder(paymentMethod: string): Promise<any>;
}
//# sourceMappingURL=blinkit.d.ts.map