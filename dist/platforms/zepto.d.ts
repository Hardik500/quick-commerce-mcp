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
import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, OrderPreview } from './base.js';
/** Zepto bill rows: "Item Total ₹125 ₹123", "Delivery Fee ₹30", "Handling Fee ₹10 FREE" (waived = 0). */
export declare function parseZeptoBill(rows: string[]): {
    subtotal: number;
    total: number;
    fees: {
        label: string;
        amount: number;
    }[];
};
export declare class ZeptoPlatform extends QuickCommercePlatform {
    private selectors;
    constructor();
    /**
     * Verdict from Zepto's own auth API. The OTP screen renders no error text at
     * all on a rejected code, so scraping the DOM says nothing useful - only
     * POST /api/auth/verify-otp knows. Recorded by the listener in initialize().
     */
    private authVerdict?;
    /**
     * Read through a method so the `= undefined` reset in sendOtp/submitOtp can't
     * narrow the field to `never` at the later read sites.
     */
    private verdict;
    /** When the current OTP was sent, to spot a code the user read too late. */
    private otpRequestedAt?;
    initialize(context: BrowserContext): Promise<void>;
    /** Persist cookies + localStorage so the next run starts already logged in. */
    saveSession(): Promise<void>;
    checkLogin(): Promise<{
        loggedIn: boolean;
        otpSent?: boolean;
        phone?: string;
    }>;
    sendOtp(phone: string): Promise<boolean>;
    /**
     * Open the login panel so its fields are inspectable. Without this a
     * diagnosis of `phoneInput` would run against a homepage that has no phone
     * field on it at all.
     */
    prepareForStep(step: string): Promise<void>;
    submitOtp(otp: string): Promise<boolean>;
    search(query: string): Promise<SearchResult>;
    private extractProductResults;
    private extractCardQuantity;
    private extractQuantity;
    addToCart(productId: string, quantity: number): Promise<boolean>;
    private openCart;
    private lastPrice;
    getCart(): Promise<CartSummary | null>;
    private extractCartItems;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    protected openAddressPicker(): Promise<Locator>;
    getLatestOrder(): Promise<string | null>;
    getOrderPreview(): Promise<OrderPreview | null>;
    private armedTotal?;
    placeOrder(paymentMethod: string, confirm?: boolean, detail?: string): Promise<any>;
    private armedCard?;
    private readCvv;
    /** Saved card: selecting the card row creates the pending order, so step 1 only verifies; step 2 selects, fills CVV, pays. */
    private placeCardOrder;
    /** UPI via QR: step 2 click creates a pending order and shows a QR (valid ~3.5 min) that the user scans. */
    private placeQrOrder;
}
//# sourceMappingURL=zepto.d.ts.map