/**
 * Swiggy Instamart implementation
 * URL: https://www.swiggy.com/instamart
 */
import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, OrderPreview } from './base.js';
/**
 * Instamart bill is one text line per cell: label, then "struck original, actual" or a single amount or "FREE"
 * (e.g. "Handling Fee","₹12.83","₹12.00" / "Delivery Partner Fee","₹30.00","FREE"). Last amount is what's charged.
 */
export declare function parseInstamartBill(lines: string[]): {
    subtotal: number;
    total: number;
    fees: {
        label: string;
        amount: number;
    }[];
};
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
    sendOtp(phone: string): Promise<boolean>;
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
    selectAddress(addressId: string, retried?: boolean): Promise<boolean>;
    getOrderPreview(): Promise<OrderPreview | null>;
    private armedTotal?;
    placeOrder(paymentMethod: string, confirm?: boolean): Promise<any>;
}
//# sourceMappingURL=swiggy-instamart.d.ts.map