/**
 * Blinkit (formerly Grofers) platform implementation
 * URL: https://blinkit.com
 */
import { BrowserContext, Locator } from 'playwright';
import { LoginStatus, QuickCommercePlatform, SearchResult, CartSummary, OrderPreview } from './base.js';
import type { AddOutcome } from '../engine/add-strategy.js';
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
    /**
     * Clear the two interstitials a fresh Blinkit load puts up: the "Get the app"
     * prompt, then the "Select your location" modal behind it.
     *
     * These render client-side after hydration, so each step waits for its own
     * trigger rather than querying once after navigation - a plain `page.$()`
     * right after `goto(domcontentloaded)` finds nothing and the modals survive.
     * ReactModal reuses one overlay node for both, so wait on the text of the
     * step you want, never on the overlay detaching.
     *
     * Returns the reason any modal survived, or null when the page is clear.
     */
    private handleInitialPopups;
    /**
     * "Select manually" fallback for when geolocation doesn't resolve the modal.
     * Types a place name / pincode into Blinkit's own search box and takes the
     * first suggestion. Needs no coordinates, so the connector is never hard
     * blocked on a position it cannot determine.
     */
    private clearLocationModalBySearch;
    checkLogin(): Promise<LoginStatus>;
    /** Remembered so checkLogin can name the number the OTP went to. */
    private otpPhone?;
    sendOtp(phone: string): Promise<boolean>;
    submitOtp(otp: string): Promise<boolean>;
    /** Persist cookies + localStorage so the next run starts already logged in. */
    saveSession(): Promise<void>;
    search(query: string): Promise<SearchResult>;
    private extractProductResults;
    private extractQuantity;
    addToCart(productId: string, quantity: number): Promise<AddOutcome>;
    private cartNotice?;
    private openCart;
    private dismissClosedStoreDialog;
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