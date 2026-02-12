/**
 * API-based Quick Commerce Interface
 * Reverse-engineered mobile API approach
 * Use when browser automation is blocked
 */
export interface APICredentials {
    phone?: string;
    email?: string;
    authToken?: string;
    refreshToken?: string;
}
export interface ProductFromAPI {
    id: string;
    sku: string;
    name: string;
    brand?: string;
    price: number;
    mrp?: number;
    discount?: string;
    quantity: string;
    imageUrl: string;
    inStock: boolean;
    category: string;
    deliveryTime?: string;
}
/**
 * Zepto API Client
 * Based on mobile app reverse engineering patterns
 */
export declare class ZeptoAPIClient {
    private baseURL;
    private credentials;
    private headers;
    initialize(phone?: string): Promise<{
        otpSent: boolean;
        message: string;
    }>;
    verifyOtp(phone: string, otp: string): Promise<{
        success: boolean;
        authToken?: string;
    }>;
    searchProducts(query: string, lat?: number, lng?: number): Promise<ProductFromAPI[]>;
    private getSimulatedProducts;
    addToCart(productId: string, quantity: number): Promise<{
        success: boolean;
        cartId?: string;
    }>;
    getCart(): Promise<{
        items: any[];
        total: number;
        deliveryFee: number;
    }>;
}
/**
 * Mobile App Reverse Engineering Guide
 *
 * To get real API endpoints:
 *
 * 1. Install Zepto/Swiggy/Blinkit app on device
 * 2. Setup mitmproxy or Charles Proxy on device
 * 3. Disable SSL pinning (requires rooted device or Frida)
 * 4. Intercept API calls while using app
 * 5. Extract:
 *    - Base URL
 *    - Endpoints (search, add to cart, checkout)
 *    - Headers (X-App-Version, User-Agent, etc.)
 *    - Auth flow (OTP → token → refresh)
 *    - Request/response formats
 *
 * 6. Implement real client below
 */
export declare class SwiggyInstamartAPIClient {
    private baseURL;
}
export declare class BlinkitAPIClient {
    private baseURL;
}
/**
 * Hybrid Client: Tries Browser → API → Manual
 */
export declare class HybridQuickCommerceClient {
    private apiClient;
    private mode;
    constructor();
    search(query: string, location?: string): Promise<ProductFromAPI[] | {
        mode: string;
        message: string;
    }>;
}
//# sourceMappingURL=quick-commerce-api.d.ts.map