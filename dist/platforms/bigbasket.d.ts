import { BrowserContext, Locator } from 'playwright';
import { QuickCommercePlatform, LoginStatus, SearchResult, CartSummary, Address, OrderPreview } from './base.js';
import type { AddOutcome } from '../engine/add-strategy.js';
export declare class BigBasketPlatform extends QuickCommercePlatform {
    private qrCheckout;
    private products;
    private addresses;
    private suggestionIds;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
    private assertPage;
    checkLogin(): Promise<LoginStatus>;
    sendOtp(phone: string): Promise<boolean>;
    submitOtp(otp: string): Promise<boolean>;
    search(query: string): Promise<SearchResult>;
    private quantity;
    addToCart(id: string, quantity: number): Promise<AddOutcome>;
    getCart(): Promise<CartSummary | null>;
    removeFromCart(id: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    protected openAddressPicker(): Promise<Locator>;
    getAddresses(): Promise<Address[]>;
    selectAddress(id: string): Promise<boolean>;
    getOrderPreview(): Promise<OrderPreview | null>;
    placeOrder(paymentMethod?: string, confirm?: boolean, provider?: string): Promise<import("../wallet.js").WalletOrderResult>;
}
//# sourceMappingURL=bigbasket.d.ts.map