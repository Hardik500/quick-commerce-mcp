/**
 * Bulletproof Zepto implementation with resilient selector engine
 * Self-healing, AI-powered selector discovery
 */
import { BrowserContext } from 'playwright';
import { QuickCommercePlatform, SearchResult, CartSummary, Address } from '../platforms/base.js';
export declare class BulletproofZeptoPlatform extends QuickCommercePlatform {
    private selectorEngine;
    constructor();
    initialize(context: BrowserContext): Promise<void>;
    /**
     * Auto-discover and cache selectors for critical UI elements
     */
    private discoverCriticalSelectors;
    checkLogin(): Promise<{
        loggedIn: boolean;
        otpSent?: boolean;
        phone?: string;
    }>;
    private extractPhoneNumber;
    submitOtp(otp: string): Promise<boolean>;
    search(query: string, location?: string): Promise<SearchResult>;
    /**
     * Intelligently discover products on the page
     */
    private discoverProducts;
    /**
     * Manual product scanning as fallback
     */
    private manualProductScan;
    /**
     * Extract product data from element using multiple strategies
     */
    private extractProductData;
    private findProductName;
    private findProductPrice;
    private findProductMRP;
    private checkStockStatus;
    private isDescendant;
    private findButtonByText;
    private parsePrice;
    private extractQuantity;
    addToCart(productId: string, quantity: number): Promise<boolean>;
    getCart(): Promise<CartSummary | null>;
    removeFromCart(productId: string): Promise<boolean>;
    clearCart(): Promise<boolean>;
    getAddresses(): Promise<Address[]>;
    selectAddress(addressId: string): Promise<boolean>;
    getOrderPreview(): Promise<any>;
    placeOrder(paymentMethod: string): Promise<any>;
}
//# sourceMappingURL=bulletproof-zepto.d.ts.map