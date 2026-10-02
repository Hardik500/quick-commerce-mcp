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
    /** Enter the phone number and request an OTP. Override per platform. */
    async sendOtp(_phone) {
        throw new Error('Not supported for this platform. Run `npx -y -p quick-commerce-mcp quick-commerce-mcp-login <platform>` instead.');
    }
    /**
     * Get saved addresses. `id` is the card's position in the picker.
     */
    // The picker may reorder cards by distance from the current location, so the
    // first listing is cached to keep ids stable. ponytail: restart to pick up new addresses.
    addressCache;
    async getAddresses() {
        if (!this.page)
            return [];
        if (this.addressCache)
            return this.addressCache;
        try {
            const cards = await this.openAddressPicker();
            const texts = await cards.allInnerTexts();
            await this.page.keyboard.press('Escape');
            return (this.addressCache = texts.map((t, i) => {
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
            }));
        }
        catch (error) {
            console.error('Error getting addresses:', error);
            return [];
        }
    }
    /**
     * Run a UI action (click) and wait until the page text changes, instead of
     * sleeping a fixed time. Resolves anyway on timeout (action may be a no-op).
     */
    async afterChange(action, timeout = 5000) {
        const page = this.page;
        const before = await page.evaluate(() => document.body.innerText);
        await action();
        await page
            .waitForFunction((b) => document.body.innerText !== b, before, { timeout })
            .catch(() => { });
    }
    /**
     * Select delivery address by id from getAddresses().
     */
    async selectAddress(addressId, retried = false) {
        if (!this.page)
            return false;
        try {
            const target = (await this.getAddresses())[Number(addressId)];
            if (!target)
                return false;
            const cards = await this.openAddressPicker();
            // Match by text, not position: card order changes with the current location.
            const card = cards.filter({ hasText: target.addressLine1.split(',')[0] }).filter({ hasText: target.label }).first();
            if ((await card.count()) === 0)
                return false;
            await card.click();
            // Picker closes once the address is applied.
            await cards.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => { });
            return true;
        }
        catch (error) {
            // Picker clicks are flaky on the mobile viewport ("outside of the viewport"); retry once.
            if (!retried)
                return this.selectAddress(addressId, true);
            console.error('Error selecting address:', error);
            return false;
        }
    }
    /** Text of the most recent order (status, items, total), or null if unsupported/none. */
    async getLatestOrder() { return null; }
    /** Known payment option labels, matched against the payment screen text. */
    static PAYMENT_LABELS = [
        'Google Pay', 'GPay', 'PhonePe', 'Paytm', 'BHIM', 'CRED', 'Amazon Pay', 'Mobikwik',
        'LazyPay', 'Pluxee', 'Netbanking', 'Net Banking', 'Cash on Delivery', 'Pay on Delivery',
        'Add New Card', 'Add credit or debit cards', 'Navi', 'Pay via QR Code', 'Pay Later', 'UPI',
    ];
    scanPaymentMethods(text) {
        // "Cash on delivery is not available for orders below ₹50" is not an option.
        text = text.replace(/cash on delivery is not available[^\n]*/gi, '');
        const lower = text.toLowerCase();
        const labels = QuickCommercePlatform.PAYMENT_LABELS.filter(l => lower.includes(l.toLowerCase()));
        // Saved cards render as "HDFC Credit Card\n**** 9292" / "Hsbc Mastercard Card\n****** 8023".
        const cards = [...text.matchAll(/([A-Za-z][A-Za-z ]*? Card)\s*\*{2,6}\s*(\d{4})/g)]
            .map(m => `${m[1].trim()} ••${m[2]}`);
        return [...new Set([...labels, ...cards])];
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