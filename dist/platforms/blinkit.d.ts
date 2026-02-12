/**
 * Blinkit (formerly Grofers) platform implementation
 * URL: https://blinkit.com
 */
import { BrowserContext } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, Address } from './base.js';
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
    private extractPhoneNumber;
    submitOtp(otp: string): Promise<boolean>;
    search(query: string, location?: string): Promise<SearchResult>;
    private setLocation;
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
//# sourceMappingURL=blinkit.d.ts.map