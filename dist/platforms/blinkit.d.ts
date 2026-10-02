/**
 * Blinkit (formerly Grofers) platform implementation
 * URL: https://blinkit.com
 */
import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, OrderPreview } from './base.js';
/** Bill rows look like "Items total Saved ₹2 ₹195 ₹193" or "Handling charge ₹12": last ₹ amount is what's charged. */
export declare function parseBill(rows: string[]): {
    subtotal: number;
    total: number;
    fees: {
        label: string;
        amount: number;
    }[];
};
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
    sendOtp(phone: string): Promise<boolean>;
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
    private selectedAddress?;
    selectAddress(addressId: string, retried?: boolean): Promise<boolean>;
    getLatestOrder(): Promise<string | null>;
    getOrderPreview(): Promise<OrderPreview | null>;
    private armedTotal?;
    private armedCard?;
    private readCvv;
    /** Saved card: selecting a card and typing the CVV creates no order on Blinkit, so step 1 stops at the ready "Pay Now". */
    private placeCardOrder;
    /** UPI collect: fill the VPA, stop before "Checkout" (which sends the request to the phone). */
    private placeUpiOrder;
    placeOrder(paymentMethod: string, confirm?: boolean, upiId?: string): Promise<any>;
}
//# sourceMappingURL=blinkit.d.ts.map