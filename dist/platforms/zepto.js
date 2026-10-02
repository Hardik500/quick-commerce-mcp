import { QuickCommercePlatform, } from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';
import { storeNotice } from '../ranking.js';
import { selectorFor } from '../flows.js';
/** Zepto bill rows: "Item Total ₹125 ₹123", "Delivery Fee ₹30", "Handling Fee ₹10 FREE" (waived = 0). */
export function parseZeptoBill(rows) {
    let subtotal = 0, total = 0;
    const fees = [];
    for (const r of rows) {
        const text = r.replace(/\s+/g, ' ').trim();
        const i = text.indexOf('₹');
        if (i < 0)
            continue;
        const label = text.slice(0, i).trim();
        const amounts = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));
        const amount = amounts[amounts.length - 1];
        if (/^item total/i.test(label))
            subtotal = amount;
        else if (/^to pay/i.test(label))
            total = amount;
        else if (/(fee|charge|tip|donation)s?$/i.test(label) && !/^(savings|discount)/i.test(label) && !/\bfree\b/i.test(text) && amount)
            fees.push({ label, amount });
    }
    return { subtotal, total, fees };
}
export class ZeptoPlatform extends QuickCommercePlatform {
    // Verified against the live site with an authenticated session
    // (scripts/inspect-selectors.ts inspectZeptoAuthenticated) on 2026-09-28.
    selectors = {
        searchInput: 'input[role="combobox"]',
        searchResults: 'a[data-testid="product-card"]',
        productName: '[data-slot-id="ProductName"]',
        productPrice: '[data-slot-id="EdlpPrice"]',
        productMRP: '[data-slot-id="Mrp"]',
        addToCartButton: 'button:has-text("ADD")',
        incrementButton: 'button[aria-label="Increase quantity"]',
        decrementButton: 'button[aria-label="Decrease quantity"]',
        cartIcon: '[data-testid="cart"], a[href*="cart"], button[class*="cart"], [class*="CartIcon"]',
        // /cart page structure (scripts/qc-cart-probe.mts style probe on
        // 2026-09-29). Each row is a div wrapping the product link and a
        // per-row stepper whose quantity testid ends in "-cart-qty".
        cartItems: 'div:has(> a[href*="/pvid/"]):has([data-testid$="-cart-qty"])',
        cartItemName: '.__4sxPD',
        cartItemVariant: '.K96_o',
        cartItemQty: '[data-testid$="-cart-qty"]',
        cartItemMinus: '[data-testid$="-minus-btn"]',
        billItemTotal: 'div.flex.justify-between:has(span:text-is("Item Total"))',
        billToPay: 'div.flex.justify-between:has(span:text-is("To Pay"))',
        loginButton: 'button[aria-label="login" i]',
        phoneInput: 'input[type="tel"], input[placeholder*="phone"], input[placeholder*="mobile"], input[placeholder*="number"]',
        otpInput: 'input[aria-label="OTP" i], input[autocomplete="one-time-code"]',
        addressSelector: '[data-testid="user-address"], .address, [class*="AddressCard"]',
        // CloudFront detection
        blockedPage: 'h1:has-text("403"), h2:has-text("Request blocked"), h1:has-text("ERROR")',
    };
    constructor() {
        super('zepto', 'https://www.zeptonow.com');
    }
    /**
     * Verdict from Zepto's own auth API. The OTP screen renders no error text at
     * all on a rejected code, so scraping the DOM says nothing useful - only
     * POST /api/auth/verify-otp knows. Recorded by the listener in initialize().
     */
    authVerdict;
    /**
     * Read through a method so the `= undefined` reset in sendOtp/submitOtp can't
     * narrow the field to `never` at the later read sites.
     */
    verdict() {
        return this.authVerdict;
    }
    /** When the current OTP was sent, to spot a code the user read too late. */
    otpRequestedAt;
    async initialize(context) {
        this.context = context;
        // Session (cookies + localStorage) is restored via storageState when the
        // context is created (see session-helper.ts / index.ts), so nothing to
        // load here.
        this.page = await context.newPage();
        // Watch the auth endpoints so a rejected OTP can be reported with Zepto's
        // own wording instead of a guess.
        this.page.on('response', async (res) => {
            const kind = /verify-otp/i.test(res.url()) ? 'verify' : /send-otp/i.test(res.url()) ? 'send' : null;
            if (!kind)
                return;
            try {
                const body = JSON.parse(await res.text());
                this.authVerdict = {
                    kind,
                    status: res.status(),
                    message: String(body?.message ?? body?.error?.message ?? body?.error ?? '').slice(0, 200),
                    at: Date.now(),
                };
            }
            catch {
                this.authVerdict = { kind, status: res.status(), message: '', at: Date.now() };
            }
        });
        // Set viewport to mobile for better compatibility
        await this.page.setViewportSize({ width: 390, height: 844 });
        // Add stealth scripts
        await this.page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        // Navigate to base URL
        const response = await this.page.goto(this.baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        // Check if blocked by CloudFront
        if (response?.status() === 403) {
            console.error('❌ Zepto returned 403 - CloudFront blocking automated browsers');
            console.error('💡 Tip: Use interactive login mode to save an authenticated session:');
            console.error('   npx tsx src/session-helper.ts login zepto');
        }
        await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => { });
        // Check for blocked page
        const blockedEl = await this.page.$(this.selectors.blockedPage);
        if (blockedEl) {
            console.error('❌ Zepto blocked the request (bot detection)');
        }
    }
    /** Persist cookies + localStorage so the next run starts already logged in. */
    async saveSession() {
        if (!this.context)
            return;
        ensureSessionDir();
        const filePath = sessionPath('zepto');
        await this.context.storageState({ path: filePath });
        console.log('✅ Session saved to', filePath);
    }
    async checkLogin() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // The login button only appears after the SPA hydrates, so a check
            // performed too early would falsely report "logged in".
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            // CloudFront/WAF block pages have no login UI either - detect them
            // explicitly so they aren't mistaken for a logged-in state.
            const blockedEl = await this.page.$(this.selectors.blockedPage);
            if (blockedEl) {
                console.error('❌ Zepto blocked the request (bot detection) - cannot determine login state');
                this.isLoggedIn = false;
                return { loggedIn: false };
            }
            // Absence of the login button is not evidence of a session: on an
            // anonymous load Zepto hides it behind the profile/location sheet, and a
            // blocked or half-hydrated page drops it too. Requiring a real account
            // signal instead means a fresh context reports "not logged in" and login
            // gets offered, rather than a false positive that makes every later
            // search() throw "Not logged in".
            //
            // Most cookies can't be used for this: an anonymous load is already handed
            // live `session_id` / `session_count` / `device_id` / `pwa` cookies, which
            // is what made the old "any session cookie" check report "logged in" on a
            // never-authenticated context. `user_id` is the one that distinguishes an
            // account - Zepto's own constants map USER_ID to the `user_id` cookie
            // (its JS reads it as a cookie, alongside session_id/pwa/csrfSecret) and
            // an anonymous load never sets it. localStorage is checked too, since the
            // token can also land there depending on the login path.
            const cookies = await this.context.cookies();
            if (cookies.some(c => c.name === 'user_id' && c.value)) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            const storage = await this.context.storageState();
            const authed = (storage.origins ?? []).some(origin => (origin.localStorage ?? []).some(entry => /^(user_?id|x-user-id|auth_token|access_token)$/i.test(entry.name) && (entry.value ?? '').length > 4));
            if (authed) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            this.isLoggedIn = false;
            return { loggedIn: false };
        }
        catch (error) {
            console.error('Error checking login status:', error);
            return { loggedIn: false };
        }
    }
    async sendOtp(phone) {
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        // A previous code stops working as soon as a new one is sent, so record when
        // this one went out; submitOtp can then tell a stale code from a wrong one.
        this.otpRequestedAt = Date.now();
        this.authVerdict = undefined;
        await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const tel = page
            .locator(selectorFor(this.name, 'phoneInput', 'input[type="tel"][placeholder*="Phone" i]'))
            .first();
        if (!(await tel.count())) {
            // The login panel is a sheet: it can already be open from a previous call
            // (the input is then present but not yet laid out), or the trigger may be
            // under Zepto's own location sheet. Give the panel a moment, click the
            // trigger only if the field really is missing, and name the blocker.
            try {
                if (await tel.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false)) {
                    await tel.click({ timeout: 5000 }).catch(() => { });
                }
                else {
                    await page.locator(selectorFor(this.name, 'loginTrigger', this.selectors.loginButton)).first().click({ timeout: 10000 });
                }
            }
            catch {
                throw new Error("Zepto's login panel did not open. This is usually a slow first paint or a bot check, not a " +
                    'missing setting - retrying once usually works. If it keeps failing, run ' +
                    '`npx -y -p quick-commerce-mcp quick-commerce-mcp-login zepto` to log in by hand.');
            }
        }
        await tel.waitFor({ state: 'visible', timeout: 15000 });
        await tel.click();
        await tel.pressSequentially(phone, { delay: 80 });
        // Zepto's Continue stays disabled for numbers its own validator rejects, so
        // check it instead of burning the default 30s click timeout on a dead button.
        const continueBtn = page.locator('button[type="submit"]:has-text("Continue")').first();
        await continueBtn.waitFor({ state: 'visible', timeout: 8000 });
        if (!(await continueBtn.isEnabled().catch(() => false))) {
            throw new Error(`Zepto rejected the number ${phone} (its Continue button stayed disabled).`);
        }
        await continueBtn.click({ timeout: 10000 });
        return page
            .locator(this.selectors.otpInput)
            .first()
            .waitFor({ timeout: 15000 })
            .then(() => true, () => false);
    }
    /**
     * Open the login panel so its fields are inspectable. Without this a
     * diagnosis of `phoneInput` would run against a homepage that has no phone
     * field on it at all.
     */
    async prepareForStep(step) {
        if (!/phoneInput|loginTrigger/.test(step))
            return;
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const tel = page
            .locator(selectorFor(this.name, 'phoneInput', 'input[type="tel"][placeholder*="Phone" i]'))
            .first();
        // Mirror sendOtp's pacing: give the SPA a moment, then click the trigger and
        // wait for the field. Clicking straight after navigation is too early on a
        // cold load and the panel never opens.
        await page.waitForTimeout(2500);
        if (!(await tel.count())) {
            await page
                .locator(selectorFor(this.name, 'loginTrigger', this.selectors.loginButton))
                .first()
                .click({ timeout: 10000 })
                .catch(() => { });
        }
        await tel.waitFor({ state: 'attached', timeout: 12000 }).catch(() => { });
    }
    async submitOtp(otp) {
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        try {
            const otpInput = page.locator(selectorFor(this.name, 'otpInput', this.selectors.otpInput)).first();
            if (!(await otpInput.count())) {
                // Distinguish "the OTP screen is gone" (someone already completed it)
                // from "it never appeared", so the caller doesn't send the user hunting
                // for a code that was never asked for.
                return (await this.checkLogin()).loggedIn;
            }
            await otpInput.fill(otp);
            if ((await otpInput.inputValue().catch(() => '')).replace(/\D/g, '') !== otp.replace(/\D/g, '')) {
                throw new Error(`Zepto's OTP field rejected ${otp} (it holds "${await otpInput.inputValue()}")`);
            }
            // Zepto's OTP screen has no Verify/Submit button (measured on the live
            // screen 2026-10-02) - it submits on Enter. On a rejected code the field
            // stays put and the screen shows no error text, so the verdict has to come
            // from POST /api/auth/verify-otp rather than the DOM.
            const verifyBtn = page.locator('button:has-text("Verify"), button:has-text("Submit")').first();
            this.authVerdict = undefined;
            if (await verifyBtn.count()) {
                await verifyBtn.click({ timeout: 8000 }).catch(() => { });
            }
            else {
                await otpInput.press('Enter', { timeout: 8000 }).catch(() => { });
            }
            // Wait for the API to answer rather than for the field to vanish: the
            // response arrives whether the code was accepted or rejected. Only a
            // verdict about the *verify* call counts here - the send call's own 200
            // is still sitting in the slot.
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline && this.verdict()?.kind !== 'verify') {
                await page.waitForTimeout(250);
            }
            const verdict = this.verdict();
            const loginCheck = await this.checkLogin();
            if (loginCheck.loggedIn) {
                await this.saveSession();
                return true;
            }
            if (verdict && verdict.status >= 400) {
                throw new Error(`Zepto rejected the OTP: ${verdict.message || `HTTP ${verdict.status}`}. ` +
                    'The connector sent the code exactly as given, so the code itself was wrong or already used - ' +
                    'call request_otp for a fresh one. (Zepto invalidates the previous code the moment a new one is sent.)');
            }
            if (!(await otpInput.waitFor({ state: 'hidden', timeout: 8000 }).then(() => true, () => false))) {
                const err = (await page.locator('body').innerText().catch(() => ''))
                    .match(/[^\n]*(?:invalid|incorrect|expired|wrong|try again|resend|maximum|attempts)[^\n]*/i)?.[0]
                    ?.trim();
                const age = this.otpRequestedAt ? Math.round((Date.now() - this.otpRequestedAt) / 60000) : null;
                throw new Error(`Zepto did not accept the OTP (the field is still showing)${err ? `: ${err}` : ''}` +
                    `${age !== null ? `. The code was requested ${age} min ago` : ''}. ` +
                    'Call request_otp for a fresh code rather than resubmitting this one.');
            }
            return false;
        }
        catch (error) {
            console.error('Error submitting OTP:', error);
            throw error;
        }
    }
    async search(query) {
        if (!this.page)
            throw new Error('Platform not initialized');
        if (!this.isLoggedIn) {
            throw new Error('Not logged in. Please login first.');
        }
        try {
            // Typing into the bare /search page can leave its "trending" cards on
            // screen; the query URL renders only the real results.
            await this.page.goto(`${this.baseUrl}/search?query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            await this.page.waitForSelector(this.selectors.searchResults, { timeout: 10000 }).catch(() => { });
            // Extract products
            const products = await this.extractProductResults();
            return {
                query,
                platform: this.name,
                products,
                totalResults: products.length,
            };
        }
        catch (error) {
            console.error('Error searching:', error);
            return {
                query,
                platform: this.name,
                products: [],
                totalResults: 0,
            };
        }
    }
    async extractProductResults() {
        if (!this.page)
            return [];
        const products = [];
        try {
            const productElements = await this.page.$$(this.selectors.searchResults);
            for (const element of productElements.slice(0, 20)) { // Limit to first 20
                try {
                    const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
                    const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    // Try to get MRP if available
                    let mrp;
                    try {
                        const mrpText = await element.$eval(this.selectors.productMRP, el => el.textContent?.trim());
                        mrp = this.parsePrice(mrpText || '');
                    }
                    catch {
                        mrp = undefined;
                    }
                    // Product cards all share data-testid="product-card"; the unique
                    // ID lives in the "pvid" segment of the card's link href instead.
                    const productId = await element.evaluate(el => {
                        const href = el.getAttribute('href') || '';
                        const match = href.match(/\/pvid\/([^/?]+)/);
                        return match ? match[1] : Math.random().toString(36).substring(7);
                    });
                    products.push({
                        id: productId,
                        name: name || 'Unknown Product',
                        price,
                        mrp,
                        quantity: await this.extractCardQuantity(element, name),
                        platform: this.name,
                        inStock: true, // Assume in stock if visible
                    });
                }
                catch {
                    // Skip products that fail extraction
                }
            }
        }
        catch (error) {
            console.error('Error extracting products:', error);
        }
        return products;
    }
    // Pack size ("1 pack (250 ml)") is the card line right after the name.
    async extractCardQuantity(card, name) {
        const lines = (await card.innerText()).split('\n').map(l => l.trim());
        const i = lines.indexOf(name);
        return i >= 0 && lines[i + 1] ? lines[i + 1] : this.extractQuantity(name);
    }
    extractQuantity(name) {
        // Try to extract quantity from product name like "Coke Zero 300ml", "Milk 1L"
        const match = name.match(/(\d+\s*(?:ml|L|g|kg|pcs|pack))/i);
        return match ? match[1] : '1 unit';
    }
    async addToCart(productId, quantity) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Product cards all share data-testid="product-card"; find the one
            // whose href contains the pvid we extracted during search.
            const product = await this.page.$(`${this.selectors.searchResults}[href*="/pvid/${productId}"]`);
            if (!product) {
                console.log('Product not found:', productId);
                return false;
            }
            const addButton = await product.$(this.selectors.addToCartButton);
            if (!addButton) {
                console.log('Add to cart button not found');
                return false;
            }
            await this.afterChange(() => addButton.click());
            // The ADD button turns into a stepper once the item is in the cart.
            const stepper = await product.waitForSelector(this.selectors.incrementButton, { timeout: 5000 }).catch(() => null);
            if (!stepper) {
                console.log('Item did not land in cart:', productId);
                return false;
            }
            for (let i = 1; i < quantity; i++) {
                const incrementButton = await product.waitForSelector(this.selectors.incrementButton, { timeout: 5000 }).catch(() => null);
                if (incrementButton)
                    await this.afterChange(() => incrementButton.click());
            }
            return true;
        }
        catch (error) {
            console.error('Error adding to cart:', error);
            return false;
        }
    }
    async openCart() {
        if (!this.page)
            return;
        await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Cart is ready once either a row or the bill summary renders.
        await this.page
            .locator(`${this.selectors.cartItems}, ${this.selectors.billToPay}`)
            .first()
            .waitFor({ timeout: 10000 })
            .catch(() => { });
    }
    // Bill rows can hold a strikethrough original price alongside the final
    // one (e.g. "₹229 ₹184"); take the last ₹ amount as the actual value.
    lastPrice(text) {
        const matches = [...text.matchAll(/₹\s*[\d,.]+/g)];
        return matches.length ? this.parsePrice(matches[matches.length - 1][0]) : 0;
    }
    async getCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            const cartItems = await this.extractCartItems();
            const rows = await this.page.locator('div.flex.justify-between').evaluateAll(e => e.map(x => x.innerText));
            const bill = parseZeptoBill(rows);
            const subtotal = bill.subtotal || cartItems.reduce((sum, item) => sum + item.price * item.cartQuantity, 0);
            const total = bill.total || subtotal;
            const fees = bill.fees;
            return {
                platform: this.name,
                items: cartItems,
                subtotal,
                deliveryFee: total - subtotal,
                fees,
                total,
                notice: storeNotice(await this.page.locator('body').innerText().catch(() => '')),
            };
        }
        catch (error) {
            console.error('Error getting cart:', error);
            return null;
        }
    }
    async extractCartItems() {
        if (!this.page)
            return [];
        const items = [];
        try {
            const cartElements = await this.page.$$(this.selectors.cartItems);
            for (const element of cartElements) {
                try {
                    const name = await element.$eval(this.selectors.cartItemName, el => el.textContent?.trim() || '');
                    const variant = await element.$eval(this.selectors.cartItemVariant, el => el.textContent?.trim() || '1 unit').catch(() => '1 unit');
                    const cartQuantity = await element.$eval(this.selectors.cartItemQty, el => parseInt(el.textContent?.trim() || '1', 10) || 1);
                    const priceText = await element.evaluate(el => el.textContent || '');
                    // Zepto shows the row's line total (price × cartQuantity), not the
                    // unit price, so divide it back out to match the Product contract.
                    const price = this.lastPrice(priceText) / cartQuantity;
                    items.push({
                        id: name,
                        name,
                        price,
                        platform: this.name,
                        quantity: variant,
                        inStock: true,
                        cartQuantity,
                    });
                }
                catch {
                    // Skip items that fail extraction
                }
            }
        }
        catch (error) {
            console.error('Error extracting cart items:', error);
        }
        return items;
    }
    async removeFromCart(productId) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            // Decrement until the row disappears.
            for (let i = 0; i < 50; i++) {
                const row = this.page
                    .locator(this.selectors.cartItems)
                    .filter({ has: this.page.locator(this.selectors.cartItemName, { hasText: productId }) })
                    .first();
                // First pass: the cart may still be rendering; wait for the row.
                if (i === 0)
                    await row.waitFor({ timeout: 5000 }).catch(() => { });
                if ((await row.count()) === 0)
                    return i > 0;
                await this.afterChange(() => row.locator(this.selectors.cartItemMinus).click());
            }
            return false;
        }
        catch (error) {
            console.error('Error removing from cart:', error);
            return false;
        }
    }
    async clearCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            for (let i = 0; i < 100; i++) {
                const minus = this.page.locator(`${this.selectors.cartItems} ${this.selectors.cartItemMinus}`).first();
                if ((await minus.count()) === 0)
                    return true;
                await this.afterChange(() => minus.click());
            }
            return false;
        }
        catch (error) {
            console.error('Error clearing cart:', error);
            return false;
        }
    }
    async openAddressPicker() {
        const page = this.page;
        await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const header = page.locator('[data-testid="user-address"]').first();
        await header.waitFor({ timeout: 15000 });
        await page.keyboard.press('Escape'); // promo popups intercept the header click
        await header.click({ timeout: 8000 });
        const cards = page.locator('[data-testid="address-item"]');
        await cards.first().waitFor({ timeout: 8000 });
        return cards;
    }
    // ponytail: order list text only (status, total, time per order); no detail page parsing.
    async getLatestOrder() {
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        const seen = page.getByText(/₹\d+/).first();
        // First cold load of /account/orders often renders blank; retry with a fresh navigation.
        for (let i = 0; i < 2; i++) {
            await page.goto(`${this.baseUrl}/account/orders`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { });
            if (await seen.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
                return (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600);
            }
        }
        return null;
    }
    async getOrderPreview() {
        if (!this.page)
            throw new Error('Platform not initialized');
        const cart = await this.getCart();
        if (!cart || cart.items.length === 0)
            return null;
        try {
            // The payment sheet is a panel on the cart page (not an iframe); its
            // header carries the delivery address, followed by the payment options.
            await this.page.getByText('PAYING VIA', { exact: false }).first().click({ timeout: 8000 });
            await this.page.getByText('Pay by UPI').first().waitFor({ timeout: 10000 });
            const lines = (await this.page.locator('body').innerText()).split('\n').map(l => l.trim()).filter(Boolean);
            const at = lines.indexOf('Payment Options');
            const address = at >= 0 ? lines[at + 1] ?? '' : '';
            return { cart, address, paymentMethods: this.scanPaymentMethods(lines.join('\n')) };
        }
        catch (error) {
            console.error('Error getting order preview:', error);
            return null;
        }
    }
    armedTotal;
    // detail = last 4 digits of a saved card, for paymentMethod 'card'.
    async placeOrder(paymentMethod, confirm = false, detail) {
        if (!this.page)
            throw new Error('Platform not initialized');
        if (paymentMethod === 'upi_qr')
            return this.placeQrOrder(confirm);
        if (paymentMethod === 'card')
            return this.placeCardOrder(confirm, detail);
        if (paymentMethod !== 'cod')
            return { success: false, message: 'Only "cod", "upi_qr" and "card" are supported on Zepto.' };
        // Selecting the COD row reveals a "Pay ₹N on delivery" bar: that is the final click.
        const payBar = this.page.getByText(/^Pay ₹\d+ on delivery/).last();
        if (!confirm) {
            this.armedTotal = undefined;
            const preview = await this.getOrderPreview();
            if (!preview)
                return { success: false, message: 'Could not reach checkout (empty cart?).' };
            if (!preview.paymentMethods.includes('Cash on Delivery')) {
                return { success: false, message: 'Cash on Delivery is not offered for this cart on Zepto.' };
            }
            await this.page.locator('[class*="_cod-widget__row"]').first().click({ timeout: 5000 });
            await payBar.waitFor({ timeout: 5000 });
            this.armedTotal = preview.cart.total;
            return { success: false, ready: true, total: preview.cart.total, message: 'COD selected; stopped before "Pay on delivery".' };
        }
        if (this.armedTotal === undefined)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        this.armedTotal = undefined; // one shot, even if the click fails
        if (!(await payBar.isVisible().catch(() => false))) {
            return { success: false, message: 'Checkout screen changed since the preview; nothing was charged. Run the first step again.' };
        }
        await payBar.click({ timeout: 5000 });
        // ponytail: success signal not yet observed live; report page text for the caller to judge.
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        const text = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        return { success: true, message: `"Pay on delivery" clicked. Page now shows: ${text}` };
    }
    armedCard;
    // CVV comes from env var QC_CVV_<last4> (set in the MCP client's env block); never logged.
    // ponytail: plaintext env var, move to the keychain when hardening.
    readCvv(last4) {
        return process.env[`QC_CVV_${last4}`]?.trim() || undefined;
    }
    /** Saved card: selecting the card row creates the pending order, so step 1 only verifies; step 2 selects, fills CVV, pays. */
    async placeCardOrder(confirm, last4) {
        const page = this.page;
        if (!confirm) {
            this.armedTotal = undefined;
            this.armedCard = undefined;
            if (!last4 || !/^\d{4}$/.test(last4))
                return { success: false, message: 'Pass card_last4 (last 4 digits of a saved card).' };
            const cvv = this.readCvv(last4);
            if (!cvv)
                return { success: false, message: `No CVV configured for card ending ${last4}: set env var QC_CVV_${last4} in the MCP server config.` };
            const preview = await this.getOrderPreview();
            if (!preview)
                return { success: false, message: 'Could not reach checkout (empty cart?).' };
            const label = preview.paymentMethods.find(m => m.endsWith('••' + last4));
            if (!label)
                return { success: false, message: `No saved card ending ${last4} on Zepto. Saved: ${preview.paymentMethods.filter(m => m.includes('••')).join(', ') || 'none'}.` };
            this.armedTotal = preview.cart.total;
            this.armedCard = { label, cvv };
            return { success: false, ready: true, total: preview.cart.total, message: `Saved card ${label} available; stopped before selecting it.` };
        }
        if (this.armedTotal === undefined || !this.armedCard)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        const { label, cvv } = this.armedCard;
        this.armedTotal = undefined;
        this.armedCard = undefined; // one shot
        await page.getByText(label.split(' ••')[0], { exact: false }).first().click({ timeout: 5000 });
        // The "Make Payment" button appears once the card sheet (and its juspay iframes) is attached.
        // Only one of the iframes holds the CVV field, so wait on whichever frame renders it.
        await page.getByText('Make Payment', { exact: true }).first().waitFor({ timeout: 20000 });
        const cvvInput = await Promise.any(page.frames().map(async (f) => {
            const l = f.locator('input[name="security_code"]');
            await l.waitFor({ timeout: 15000 });
            return l;
        }));
        await cvvInput.fill(cvv);
        await page.getByText('Make Payment', { exact: true }).first().click({ timeout: 5000 });
        // ponytail: post-payment page (3DS/OTP/success) not observed yet; report what shows.
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        const image = await page.screenshot().catch(() => undefined);
        return { success: true, image, message: `"Make Payment" clicked for ${label}. Page now shows: ${text}` };
    }
    /** UPI via QR: step 2 click creates a pending order and shows a QR (valid ~3.5 min) that the user scans. */
    async placeQrOrder(confirm) {
        const page = this.page;
        if (!confirm) {
            this.armedTotal = undefined;
            const preview = await this.getOrderPreview();
            if (!preview)
                return { success: false, message: 'Could not reach checkout (empty cart?).' };
            if (!preview.paymentMethods.includes('Pay via QR Code')) {
                return { success: false, message: 'QR payment is not offered for this cart on Zepto.' };
            }
            this.armedTotal = preview.cart.total;
            return { success: false, ready: true, total: preview.cart.total, message: 'QR payment available; stopped before selecting it.' };
        }
        if (this.armedTotal === undefined)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        const total = this.armedTotal;
        this.armedTotal = undefined; // one shot
        await page.getByText(/QR/i).first().click({ timeout: 5000 });
        const valid = page.getByText(/QR code is valid for/i);
        await valid.waitFor({ timeout: 15000 });
        const card = page.getByText(/Scan and pay using any UPI app/i).first()
            .locator('xpath=ancestor::div[.//canvas or .//img or .//svg][1]');
        const image = await card.screenshot({ timeout: 5000 }).catch(() => page.screenshot());
        // ponytail: expiry from page text; payment result not polled yet (success detection comes later).
        const expiry = (await valid.locator('xpath=..').innerText().catch(() => '')).replace(/\s+/g, ' ');
        return { success: true, image, message: `QR shown for ₹${total}. ${expiry}. Ask the user to scan it with any UPI app; an unpaid order stays pending until it expires.` };
    }
}
//# sourceMappingURL=zepto.js.map