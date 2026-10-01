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
     * Get saved addresses. `id` is the card's position in the picker.
     */
    async getAddresses() {
        if (!this.page)
            return [];
        try {
            const cards = await this.openAddressPicker();
            const texts = await cards.allInnerTexts();
            await this.page.keyboard.press('Escape');
            return texts.map((t, i) => {
                const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
                const line1 = lines.slice(1).join(', ');
                return {
                    id: String(i),
                    label: lines[0] || '',
                    addressLine1: line1,
                    city: '',
                    pincode: line1.match(/\b\d{6}\b/)?.[0] || '',
                    phone: '',
                };
            });
        }
        catch (error) {
            console.error('Error getting addresses:', error);
            return [];
        }
    }
    /**
     * Select delivery address by id from getAddresses().
     */
    async selectAddress(addressId) {
        if (!this.page)
            return false;
        try {
            const cards = await this.openAddressPicker();
            if (Number(addressId) >= (await cards.count()))
                return false;
            await cards.nth(Number(addressId)).click();
            await this.page.waitForTimeout(3000);
            return true;
        }
        catch (error) {
            console.error('Error selecting address:', error);
            return false;
        }
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