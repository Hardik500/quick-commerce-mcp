export class QuickCommercePlatform {
    name;
    baseUrl;
    context = null;
    page = null;
    isLoggedIn = false;
    constructor(name, baseUrl) {
        this.name = name;
        this.baseUrl = baseUrl;
    }
    /**
     * Close browser context
     */
    async close() {
        if (this.page) {
            await this.page.close();
        }
        this.context = null;
        this.page = null;
    }
    getName() {
        return this.name;
    }
    /** Extract numeric value from price text like "₹45", "Rs. 45", "45.00". */
    parsePrice(priceText) {
        const match = priceText.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1]) : 0;
    }
    isAuthenticated() {
        return this.isLoggedIn;
    }
}
//# sourceMappingURL=base.js.map