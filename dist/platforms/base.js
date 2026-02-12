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
    isAuthenticated() {
        return this.isLoggedIn;
    }
}
//# sourceMappingURL=base.js.map