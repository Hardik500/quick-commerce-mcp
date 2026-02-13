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
import { BrowserContext } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, Address } from './base.js';
export declare class ZeptoPlatform extends QuickCommercePlatform {
    private selectors;
    private sessionLoaded;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
    private loadSession;
    saveSession(): Promise<void>;
    checkLogin(): Promise<{
        loggedIn: boolean;
        otpSent?: boolean;
        phone?: string;
    }>;
    submitOtp(otp: string): Promise<boolean>;
    search(query: string, location?: string): Promise<SearchResult>;
    private extractProductResults;
    private parsePrice;
    private extractQuantity;
    addToCart(productId: string, quantity: number): Promise<boolean>;
    getCart(): Promise<CartSummary | null>;
    private extractCartItems;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    getAddresses(): Promise<Address[]>;
    selectAddress(addressId: string): Promise<boolean>;
    getOrderPreview(): Promise<any>;
    placeOrder(paymentMethod: string): Promise<any>;
}
//# sourceMappingURL=zepto.d.ts.map