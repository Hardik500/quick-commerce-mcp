export class QuickCommercePlatform {
    name;
    baseUrl;
    context = null;
    page = null;
    isLoggedIn = false;
    /**
     * Whether `isLoggedIn` reflects a check this instance actually performed.
     *
     * Without it, `isLoggedIn` is only true if some earlier caller happened to
     * remember to call `checkLogin()`, so any new code path that reaches a guarded
     * method without doing so fails on a valid session. That already cost one bug:
     * `add_to_cart` on Instamart skipped the check, the internal `search()` threw
     * "Not logged in", and a `.catch(() => null)` turned it into "Product not
     * found". Tracked separately so `ensureSession` can verify lazily instead.
     *
     * `ensureSession` maintains this itself rather than trusting each `checkLogin`
     * to - otherwise the next platform added would have to remember, which is the
     * same trap in a new place.
     */
    sessionVerified = false;
    constructor(name, baseUrl) {
        this.name = name;
        this.baseUrl = baseUrl;
    }
    /**
     * Confirm there is a usable session, checking lazily if nobody has yet.
     *
     * Call this instead of reading `isLoggedIn` directly. It removes the trap where
     * a method throws "Not logged in" on a perfectly good session simply because
     * the caller was the first to touch the platform this instance.
     *
     * The check runs at most once per successful verification, so a normal tool
     * call still costs one cookie read, not one per guarded method. A failed check
     * is not remembered, so a transient failure does not poison the instance.
     */
    async ensureSession() {
        if (this.sessionVerified && this.isLoggedIn)
            return;
        const status = await this.checkLogin();
        if (status.loggedIn) {
            this.isLoggedIn = true;
            this.sessionVerified = true;
            return;
        }
        // Only a definite "no" counts as verified. Anything else leaves the instance
        // unverified so the next call tries again instead of replaying this result.
        this.sessionVerified = false;
        if (status.indeterminate) {
            throw new Error(`Could not confirm the ${this.name} session: ${status.reason ?? 'the page did not load as expected'}. ` +
                `This is usually a bot check or a slow page, not a logged-out account - retry in a few seconds before asking the user to log in again.`);
        }
        throw new Error('Not logged in. Please login first.');
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
    /**
     * Put the page into the state where `step`'s element should exist, so a broken
     * flow can be inspected rather than only reported. Override per platform; the
     * default does nothing for steps that live on a page already loaded.
     */
    async prepareForStep(_step) { }
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