/**
 * Zepto platform implementation
 * URL: https://www.zeptonow.com
 */
import { BrowserContext } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, Address } from './base.js';
export declare class ZeptoPlatform extends QuickCommercePlatform {
    private selectors;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
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