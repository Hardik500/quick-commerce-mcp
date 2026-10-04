/**
 * Swiggy Instamart implementation
 * URL: https://www.swiggy.com/instamart
 */
import { BrowserContext, Locator } from 'playwright';
import { LoginStatus, QuickCommercePlatform, SearchResult, CartSummary, OrderPreview } from './base.js';
import type { AddOutcome } from '../engine/add-strategy.js';
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
    /**
     * Swiggy puts up a "Share location to find the closest Instamart store" sheet
     * on any session without a saved address, covering the header at z-index
     * 10001 - the same gate Blinkit has. It renders after hydration, so it has to
     * be waited for rather than queried once after navigation.
     *
     * The sheet is deliberately NOT dismissed here. "Share location" only
     * succeeds when the context reports a real position, and Swiggy's own area
     * search leads to a Google Maps view that leaves the page unusable for
     * automation. The sheet carries its own Login button, which closes the sheet
     * on click, so sendOtp logs in through that instead. A saved address is what
     * actually needs a location, and list_addresses/select_address handle it once
     * logged in.
     *
     * Returns a note about the sheet's presence, or null when there is none.
     */
    private handleLocationPopup;
    checkLogin(): Promise<LoginStatus>;
    sendOtp(phone: string): Promise<boolean>;
    submitOtp(otp: string): Promise<boolean>;
    /** Persist cookies + localStorage so the next run starts already logged in. */
    saveSession(): Promise<void>;
    search(query: string): Promise<SearchResult>;
    private extractProductResults;
    private extractQuantity;
    private productIdentity;
    addToCart(productId: string, quantity: number): Promise<AddOutcome>;
    private findProductCard;
    /** Click through a located product card to put `quantity` in the cart. */
    private addFromCard;
    getCart(): Promise<CartSummary | null>;
    private extractCartItems;
    private openCart;
    /** Wait for this counter and the writes caused by its click, not unrelated
     * page text. The site renders counts optimistically before saving the cart. */
    private incrementQuantity;
    private changeQuantity;
    private withCartWrites;
    private activeCartRows;
    private decrementCartRow;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    protected openAddressPicker(): Promise<Locator>;
    selectAddress(addressId: string, retried?: boolean): Promise<boolean>;
    getOrderPreview(): Promise<OrderPreview | null>;
    private armedTotal?;
    placeOrder(paymentMethod: string, confirm?: boolean, provider?: string): Promise<any>;
}
//# sourceMappingURL=swiggy-instamart.d.ts.map