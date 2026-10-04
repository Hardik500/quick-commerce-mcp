import { QuickCommercePlatform, } from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';
import { storeNotice, stripPackSize } from '../ranking.js';
import { loadPrefs } from '../preferences.js';
/** Runs in the page: a legacy cookie alone also exists in logged-out sessions. */
function authenticatedClientState() {
    try {
        const auth = JSON.parse(localStorage.getItem('auth') || '{}');
        const profile = JSON.parse(localStorage.getItem('user') || '{}').profile;
        return !!auth.accessToken || !!(profile && Object.keys(profile).length);
    }
    catch {
        return false;
    }
}
/** Bill rows look like "Items total Saved ₹2 ₹195 ₹193" or "Handling charge ₹12": last ₹ amount is what's charged. */
export function parseBill(rows) {
    let subtotal = 0, total = 0;
    const fees = [];
    for (const r of rows) {
        const text = r.replace(/\s+/g, ' ').trim();
        const amounts = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replace(/,/g, '')));
        if (!amounts.length)
            continue; // header row
        const label = text.slice(0, text.indexOf('₹')).replace(/\s*Saved\s*$/i, '').trim();
        // "Delivery charge ₹30 FREE": the amount shown is waived, not charged.
        const amount = /\bFREE\b/.test(text) ? 0 : amounts[amounts.length - 1];
        if (/^items total/i.test(label))
            subtotal = amount;
        else if (/^grand total/i.test(label))
            total = amount;
        else if (amount)
            fees.push({ label, amount });
    }
    return { subtotal, total, fees };
}
export class BlinkitPlatform extends QuickCommercePlatform {
    // Verified against the live site with an authenticated session
    // (scripts/inspect-blinkit-authed.ts) on 2026-09-29. Blinkit's product
    // grid uses Tailwind utility classes (no semantic names/data-testids), so
    // selectors key off distinctive class combinations instead.
    selectors = {
        // The homepage search bar is a link (rotating placeholder text) that
        // navigates to /s/, which has the real <input>. Direct navigation to
        // /s/?q=<query> is used instead of clicking through it (see search()).
        searchInput: 'input[placeholder*="Search" i]',
        // Product cards are <div role="button"> whose `id` is the numeric
        // product ID - no stable class/data-testid identifies them, so callers
        // must filter `div[id]` matches to numeric ids (see extractProductResults).
        searchResults: 'div[id]',
        productName: '.tw-text-300.tw-font-semibold.tw-line-clamp-2',
        productQuantity: '.tw-text-200.tw-font-medium.tw-line-clamp-1',
        productPrice: '.tw-text-200.tw-font-semibold',
        productMRP: '.tw-text-200.tw-font-regular.tw-line-through',
        deliveryTime: '.tw-text-050.tw-font-bold.tw-uppercase',
        addToCartButton: '.tw-bg-green-050',
        incrementButton: 'button:has(.icon-plus)',
        decrementButton: 'button:has(.icon-minus)',
        cartIcon: 'button:has-text("Cart"), a[href*="cart"], [data-testid="cart"]',
        // /cart page structure (scripts/inspect-blinkit-authed.ts style probe on
        // 2026-09-29). Class names carry a styled-components hash suffix that can
        // change on redeploy, so match by class-name prefix instead of full class.
        cartItems: '[class*="CartProduct__Container"]',
        cartItemName: '[class*="DefaultProductCard__ProductTitle"]',
        cartItemVariant: '[class*="DefaultProductCard__ProductVariantContainer"]',
        cartItemPrice: '[class*="DefaultProductCard__Price-"]',
        cartStepper: '[class*="AddToCart__UpdatedButtonContainer"]',
        cartStepperMinus: '[class*="AddToCart___StyledDiv-"]',
        billRow: '[class*="BillCard__BillItemContainer"]',
        billLabel: '[class*="BillCard__BillItemLeftHeaderTextContent"]',
        billValue: '[class*="BillCard__BillItemRight"]',
        availability: '[data-testid="out-of-stock"], span[class*="out-of-stock"], div[class*="unavailable"]',
        // Login modal, triggered by clicking the profile icon.
        profileIcon: '[class*="profile" i]',
        phoneInput: 'input[data-test-id="phone-no-text-box"]',
        continueButton: 'button:has-text("Continue")',
        otpInput: '[data-test-id="otp-text-box"]',
        // App-install / location interstitials shown on a fresh page load.
        continueOnWebLink: 'text=Continue on web',
        useLocationButton: 'text=Use my location',
    };
    constructor() {
        super('blinkit', 'https://blinkit.com');
    }
    async initialize(context) {
        this.context = context;
        this.page = await context.newPage();
        // Blinkit works well with mobile viewport
        await this.page.setViewportSize({ width: 390, height: 844 });
        // Navigate to homepage
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => { });
        // Handle any initial popups (app-install interstitial, location prompt)
        await this.handleInitialPopups();
    }
    /**
     * Clear the two interstitials a fresh Blinkit load puts up: the "Get the app"
     * prompt, then the "Select your location" modal behind it.
     *
     * These render client-side after hydration, so each step waits for its own
     * trigger rather than querying once after navigation - a plain `page.$()`
     * right after `goto(domcontentloaded)` finds nothing and the modals survive.
     * ReactModal reuses one overlay node for both, so wait on the text of the
     * step you want, never on the overlay detaching.
     *
     * Returns the reason any modal survived, or null when the page is clear.
     */
    async handleInitialPopups() {
        if (!this.page)
            return 'page not initialised';
        const page = this.page;
        const overlay = page.locator('.ReactModal__Overlay').first();
        // Nothing to do once the session already has a location and no app prompt.
        if (!(await overlay.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false))) {
            return null;
        }
        // "Get the app" interstitial. Clicking it reveals the location modal
        // underneath, in the same overlay node.
        const continueOnWeb = page.getByText('Continue on web', { exact: false }).first();
        if (await continueOnWeb.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
            await continueOnWeb.click({ timeout: 8000 }).catch(() => { });
        }
        // "Select your location" - only shown when the session has no location yet.
        // This modal has no close button and ignores both Escape and backdrop
        // clicks, so it has to be dismissed through its own buttons.
        const useLocation = page.getByText('Use my location', { exact: false }).first();
        if (!(await useLocation.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false))) {
            return null; // the interstitial was the only thing there, and it's gone
        }
        // "Use my location" is only worth trying when the context reports a real
        // position. Blinkit's geolocation call otherwise times out (Playwright's
        // Chromium has no OS location provider) and the sheet it swaps in - an
        // empty GetLocationModal - never resolves, so it still blocks the page.
        // Without QC_GEOLOCATION, go straight to the pincode search, which the
        // site geocodes server-side and answers immediately.
        if (process.env.QC_GEOLOCATION?.trim()) {
            await useLocation.click({ timeout: 8000 }).catch(() => { });
            if (await useLocation.waitFor({ state: 'hidden', timeout: 12000 }).then(() => true, () => false)) {
                return null;
            }
            // Geolocation was configured but didn't land; fall through to the search.
        }
        return await this.clearLocationModalBySearch();
    }
    /**
     * "Select manually" fallback for when geolocation doesn't resolve the modal.
     * Types a place name / pincode into Blinkit's own search box and takes the
     * first suggestion. Needs no coordinates, so the connector is never hard
     * blocked on a position it cannot determine.
     */
    async clearLocationModalBySearch() {
        const page = this.page;
        const selectManually = page.getByText('Select manually', { exact: false }).first();
        if (!(await selectManually.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) {
            return 'Blinkit\'s "Select your location" modal is open and could not be dismissed';
        }
        await selectManually.click({ timeout: 8000 }).catch(() => { });
        const box = page.locator('input[placeholder="search delivery location"]').first();
        if (!(await box.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false))) {
            return 'Blinkit\'s "Select your location" modal is open; its manual search box never appeared';
        }
        // The pincode/area to search for comes from the saved preferences so the
        // same value is reused on every run.
        const needle = loadPrefs().pincode;
        if (!needle) {
            return 'Blinkit asks for a delivery location before login and geolocation did not resolve it. ' +
                'Save your pincode with set_preferences(pincode: "560001") to let the connector pick it, ' +
                'or set the QC_GEOLOCATION "lat,lon" env var on the MCP server.';
        }
        await box.fill(needle, { timeout: 8000 }).catch(() => { });
        // Suggestions are rows in the search sheet (LocationSearchList__LocationListContainer);
        // the first one is the exact pincode match Blinkit geocoded.
        const suggestion = page.locator('[class*="LocationSearchList__LocationListContainer"]').first();
        if (!(await suggestion.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false))) {
            return `Blinkit location modal is open and "${needle}" matched no suggestion`;
        }
        await suggestion.click({ timeout: 8000 }).catch(() => { });
        const dismissed = await suggestion.waitFor({ state: 'hidden', timeout: 12000 }).then(() => true, () => false);
        return dismissed ? null : `Blinkit location modal stayed open after selecting "${needle}"`;
    }
    async checkLogin() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Blinkit can retain this legacy cookie while its client is logged out.
            // Require authenticated client state too, rather than certifying that
            // incomplete snapshot (or accepting a rejected OTP) as a valid login.
            const cookies = await this.context.cookies();
            const authCookie = cookies.find(c => c.name === 'gr_1_accessToken');
            if (authCookie?.value && await this.page.evaluate(authenticatedClientState)) {
                this.isLoggedIn = true;
                this.sessionVerified = true;
                return { loggedIn: true };
            }
            // If a login flow was already triggered (e.g. by a prior submitOtp
            // attempt) and the OTP screen is showing, report that back so the
            // caller can prompt for the code instead of just "not logged in".
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (otpInput) {
                this.isLoggedIn = false;
                this.sessionVerified = true;
                return { loggedIn: false, otpSent: true, phone: this.otpPhone };
            }
            this.isLoggedIn = false;
            this.sessionVerified = true;
            return { loggedIn: false };
        }
        catch (error) {
            // A failed check is not a logged-out account - see the note in base.ts.
            console.error('Error checking login status:', error);
            this.isLoggedIn = false;
            this.sessionVerified = false;
            return {
                loggedIn: false,
                indeterminate: true,
                reason: `the check itself failed (${error?.message?.split('\n')[0] ?? 'unknown error'})`,
            };
        }
    }
    /** Remembered so checkLogin can name the number the OTP went to. */
    otpPhone;
    async sendOtp(phone) {
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        this.otpPhone = phone;
        const phoneInput = page.locator(this.selectors.phoneInput).first();
        // Two attempts: a leftover modal from the first load is the usual reason the
        // profile button can't be clicked, and re-running the dismissal after a
        // failed click clears it.
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const blocked = await this.handleInitialPopups();
            if (!(await phoneInput.count())) {
                try {
                    await page.locator(this.selectors.profileIcon).first().click({ timeout: 10000 });
                }
                catch {
                    // A bare "Timeout 10000ms exceeded" here means an overlay is sitting
                    // on top of the header; name it instead of reporting a click timeout.
                    const stillBlocked = await this.handleInitialPopups();
                    throw new Error(`Could not reach Blinkit's login form: ${blocked ?? stillBlocked ?? 'the header was covered by a modal'}. ` +
                        'Set a pincode with set_preferences(pincode: "...") or a position with the QC_GEOLOCATION "lat,lon" env var, ' +
                        'or run `npx -y -p quick-commerce-mcp quick-commerce-mcp-login blinkit` to log in by hand.');
                }
            }
            try {
                await phoneInput.fill(phone, { timeout: 10000 });
                await page.locator(this.selectors.continueButton).first().click({ timeout: 10000 });
            }
            catch (e) {
                if (attempt === 0)
                    continue; // the phone box can be replaced by a re-render mid-flow
                throw new Error(`Blinkit's login form did not accept the number: ${e.message.split('\n')[0]}`);
            }
            return page.locator(this.selectors.otpInput).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
        }
        return false;
    }
    async submitOtp(otp) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (!otpInput) {
                console.log('OTP input not found');
                return false;
            }
            // OTP is 4 separate single-digit boxes; typing into the first one
            // auto-advances focus through the rest (see scripts/auto-login-blinkit.ts).
            await otpInput.click();
            await this.page.keyboard.type(otp);
            await this.page.locator(this.selectors.otpInput).first().waitFor({ state: 'hidden', timeout: 15000 });
            // The boxes vanish before Blinkit finishes verification and persists the
            // account state. Saving or navigating now can freeze a logged-out state
            // beside the old cookie, which only fails on the next server startup.
            await this.page.waitForFunction(authenticatedClientState, undefined, { timeout: 15000 });
            const loginCheck = await this.checkLogin();
            if (loginCheck.loggedIn) {
                await this.saveSession();
            }
            return loginCheck.loggedIn;
        }
        catch (error) {
            console.error('Error submitting OTP:', error);
            return false;
        }
    }
    /** Persist cookies + localStorage so the next run starts already logged in. */
    async saveSession() {
        if (!this.context)
            return;
        ensureSessionDir();
        const filePath = sessionPath('blinkit');
        await this.context.storageState({ path: filePath });
        console.log('✅ Session saved to', filePath);
    }
    async search(query) {
        if (!this.page)
            throw new Error('Platform not initialized');
        // Verifies the session itself if nobody has yet, rather than trusting a flag
        // this method never set - see ensureSession in base.ts.
        await this.ensureSession();
        try {
            // Delivery location is the account's live address (change it with
            // select_address); the /s/?q= page doesn't take a location override.
            // Results render after a skeleton that can outlast a fixed delay on a
            // cold page; a timeout just means no results yet, so retry once with a
            // fresh navigation before reporting an empty list.
            let products = [];
            for (let attempt = 0; attempt < 2 && products.length === 0; attempt++) {
                await this.page.goto(`${this.baseUrl}/s/?q=${encodeURIComponent(query)}`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });
                await this.page.waitForSelector(this.selectors.productName, { timeout: 15000 }).catch(() => { });
                products = await this.extractProductResults();
            }
            this.rememberSearch(query, products);
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
            // Cards are <div id="<numeric product id>"> with no other stable
            // selector, so `searchResults` matches every div[id] on the page and
            // needs a numeric-id filter here to isolate the actual cards.
            const allDivsWithId = await this.page.$$(this.selectors.searchResults);
            const productElements = [];
            for (const el of allDivsWithId) {
                const id = await el.evaluate(node => node.id);
                if (/^\d+$/.test(id))
                    productElements.push(el);
            }
            for (const element of productElements.slice(0, 20)) {
                try {
                    // Extract product details
                    const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
                    const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    // Try to get MRP (crossed out price if exists)
                    let mrp;
                    try {
                        const mrpText = await element.$eval(this.selectors.productMRP, el => el.textContent?.trim());
                        if (mrpText) {
                            mrp = this.parsePrice(mrpText);
                        }
                    }
                    catch {
                        mrp = undefined;
                    }
                    // Check availability
                    let inStock = true;
                    try {
                        const outOfStock = await element.$(this.selectors.availability);
                        if (outOfStock) {
                            inStock = false;
                        }
                    }
                    catch {
                        // Assume in stock
                    }
                    // Get delivery time if shown
                    let deliveryTime;
                    try {
                        deliveryTime = await element.$eval(this.selectors.deliveryTime, el => el.textContent?.trim());
                    }
                    catch {
                        deliveryTime = undefined;
                    }
                    // Quantity/size (e.g. "450 ml") is shown separately from the name.
                    let quantity = '1 unit';
                    try {
                        const qtyText = await element.$eval(this.selectors.productQuantity, el => el.textContent?.trim());
                        if (qtyText)
                            quantity = qtyText;
                    }
                    catch {
                        // Fall back to parsing it out of the name below
                        quantity = this.extractQuantity(name);
                    }
                    const productId = await element.evaluate(el => el.id);
                    products.push({
                        id: productId,
                        name: name || 'Unknown Product',
                        price,
                        mrp,
                        quantity,
                        deliveryTime,
                        platform: this.name,
                        inStock,
                    });
                }
                catch (err) {
                    // Skip product if extraction fails
                    console.log('Failed to extract product:', err);
                }
            }
        }
        catch (error) {
            console.error('Error extracting products:', error);
        }
        return products;
    }
    extractQuantity(name) {
        // Extract quantity info from name like "Amul Milk 1L", "Lays Chips 52g"
        const match = name.match(/(\d+(?:\.\d+)?\s*(?:ml|L|g|kg|pcs|pack|bottle|can)s?)/i);
        return match ? match[1] : '1 unit';
    }
    async addToCart(productId, quantity) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // The product's numeric id is the card's DOM id directly.
            const card = this.page.locator(`div[id="${productId}"]`).first();
            if ((await card.count()) === 0)
                await this.restoreProductSearch(productId);
            if ((await card.count().catch(() => 0)) === 0) {
                // About this product, not about the page: the caller's other items are
                // still worth attempting.
                console.log('Product not found:', productId);
                return 'not-found';
            }
            if (await card.getByText(/out of stock|sold out|unavailable/i).first().isVisible().catch(() => false))
                return 'unavailable';
            // The ADD button turns into a -/qty/+ stepper once the item is in the
            // cart; if it doesn't (e.g. out of stock), the add did not take. Both
            // halves of the stepper count as proof, so a rename of one survives.
            const outcome = await this.addViaCard(card, {
                add: [this.selectors.addToCartButton],
                landed: [this.selectors.incrementButton, this.selectors.decrementButton],
                increment: [this.selectors.incrementButton],
            }, quantity);
            if (outcome !== 'added' && outcome !== 'already') {
                console.log(`Add to cart did not complete (${outcome}):`, productId);
            }
            return outcome;
        }
        catch (error) {
            console.error('Error adding to cart:', error);
            return 'failed';
        }
    }
    cartNotice;
    async openCart() {
        if (!this.page)
            return;
        await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Analytics/polling can keep the page busy indefinitely. Wait for cart UI,
        // including its explicit empty state, instead of unrelated network traffic.
        await this.page.locator(this.selectors.cartItems)
            .or(this.page.getByText(/(?:your )?cart is empty|empty cart/i))
            .filter({ visible: true }).first().waitFor({ timeout: 5000 }).catch(() => { });
        // A closed store still allows editing the cart, but its notice dialog
        // intercepts stepper clicks. Acknowledge that dialog through its own button.
        this.cartNotice = storeNotice(await this.page.locator('body').innerText());
        await this.dismissClosedStoreDialog();
    }
    async dismissClosedStoreDialog() {
        if (!this.page)
            return;
        const closed = this.page.locator('.ReactModal__Content').filter({ hasText: /store (is )?(currently )?closed/i }).first();
        if (await closed.isVisible().catch(() => false)) {
            await closed.locator('button[class*="DialogButton__Button"]').click({ timeout: 5000 });
            await closed.waitFor({ state: 'hidden', timeout: 5000 });
        }
    }
    async getCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            const cartItems = await this.extractCartItems();
            const rows = await this.page.locator(this.selectors.billRow).evaluateAll(e => e.map(x => x.innerText));
            const { subtotal, total, fees } = parseBill(rows);
            const itemsTotal = subtotal || cartItems.reduce((sum, item) => sum + item.price * item.cartQuantity, 0);
            return {
                platform: this.name,
                items: cartItems,
                subtotal: itemsTotal,
                deliveryFee: total ? total - itemsTotal : fees.reduce((sum, fee) => sum + fee.amount, 0),
                fees,
                total: total || itemsTotal + fees.reduce((sum, fee) => sum + fee.amount, 0),
                notice: this.cartNotice,
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
                    // Blinkit keeps a removed card in the DOM with ADD in place of the
                    // quantity. It is no longer a cart item, even though its row remains.
                    if (await element.$eval(this.selectors.cartStepper, el => el.textContent?.trim().toUpperCase() === 'ADD').catch(() => false))
                        continue;
                    const name = await element.$eval(this.selectors.cartItemName, el => el.textContent?.trim() || '');
                    const variant = await element.$eval(this.selectors.cartItemVariant, el => el.textContent?.trim() || '1 unit').catch(() => '1 unit');
                    const priceText = await element.$eval(this.selectors.cartItemPrice, el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    // The stepper's quantity is a bare text node between the minus and
                    // plus icon divs; both icons render as single glyph characters
                    // with no separator, so pull the text node directly.
                    const cartQuantity = await element.$eval(this.selectors.cartStepper, (el) => {
                        const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                        return parseInt(textNode?.textContent?.trim() || '1', 10) || 1;
                    }).catch(() => 1);
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
    async decrementCartRow(row) {
        const name = (await row.locator(this.selectors.cartItemName).innerText()).trim();
        const before = await row.locator(this.selectors.cartStepper).evaluate(el => parseInt(Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE)?.textContent?.trim() || '0', 10));
        // The quantity changes optimistically. A reload (or another decrement)
        // must not race the request that makes that quantity authoritative.
        // Blinkit POSTs a new cart, but PUTs /carts/<id> for an existing one.
        const committed = this.page.waitForResponse(response => ['POST', 'PUT'].includes(response.request().method()) && /\/v\d+\/carts(?:\/\d+)?\/?$/.test(new URL(response.url()).pathname), { timeout: 10000 }).catch(() => null);
        await row.locator(this.selectors.cartStepperMinus).click({ timeout: 3000 });
        const response = await committed;
        if (!response?.ok())
            throw new Error('Blinkit did not confirm the cart update');
        const error = await response.finished();
        if (error)
            throw error;
        await this.page.waitForFunction(({ selectors, name, before }) => {
            const row = Array.from(document.querySelectorAll(selectors.cartItems))
                .find(el => el.querySelector(selectors.cartItemName)?.textContent?.trim() === name);
            if (!row)
                return true;
            const stepper = row.querySelector(selectors.cartStepper);
            if (!stepper)
                return false;
            if (stepper.textContent?.trim().toUpperCase() === 'ADD')
                return true;
            const quantity = parseInt(Array.from(stepper.childNodes).find(n => n.nodeType === Node.TEXT_NODE)?.textContent?.trim() || '', 10);
            return quantity < before;
        }, { selectors: this.selectors, name, before }, { timeout: 5000 });
    }
    async removeFromCart(productId) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            // Decrement until the row disappears.
            const name = stripPackSize(productId);
            for (let i = 0; i < 50; i++) {
                const row = this.page
                    .locator(this.selectors.cartItems)
                    .filter({ has: this.page.locator(this.selectors.cartItemName, { hasText: name }) })
                    .first();
                const removed = async () => (await row.count()) === 0 ||
                    (await row.locator(this.selectors.cartStepper).first().innerText({ timeout: 1000 }).catch(() => '')).trim().toUpperCase() === 'ADD';
                // First pass: the drawer may still be rendering; wait for the row.
                if (i === 0)
                    await row.waitFor({ timeout: 5000 }).catch(() => { });
                if (await removed())
                    return i > 0;
                await this.dismissClosedStoreDialog();
                await this.decrementCartRow(row);
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
                const row = this.page.locator(this.selectors.cartItems)
                    .filter({ has: this.page.locator(this.selectors.cartStepperMinus) }).first();
                if ((await row.count()) === 0)
                    return true;
                await this.dismissClosedStoreDialog();
                await this.decrementCartRow(row);
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
        const bar = page.locator('[class*="LocationBar__Subtitle"]').first();
        await bar.waitFor({ timeout: 15000 });
        await bar.click({ timeout: 8000, force: true });
        const cards = page.locator('[class*="AddressListItem__AddressItemWrapperItem"]');
        await cards.first().waitFor({ timeout: 8000 });
        return cards;
    }
    selectedAddress;
    async selectAddress(addressId, retried = false) {
        const addr = (await this.getAddresses())[Number(addressId)];
        const lat = async () => (await this.page.context().cookies()).find(c => c.name === 'gr_1_lat')?.value ?? '';
        const before = await lat();
        const ok = await super.selectAddress(addressId, retried);
        if (ok) {
            this.selectedAddress = addr;
            // Blinkit applies the new location (gr_1_lat/lon cookies) ~2s after the picker
            // closes. Re-selecting the current address changes nothing; the 6s cap covers that.
            const deadline = Date.now() + 6000;
            while (Date.now() < deadline && (await lat()) === before) {
                await this.page.waitForResponse(() => true, { timeout: 500 }).catch(() => { });
            }
        }
        return ok;
    }
    // ponytail: raw page text of the newest order's detail view; no structured parsing until the layout is known.
    async getLatestOrder() {
        const page = this.page;
        if (!page)
            throw new Error('Platform not initialized');
        await page.goto('https://blinkit.com/account/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
        const card = page.getByText(/₹\d+\s*•/).first();
        if (!(await card.waitFor({ timeout: 15000 }).then(() => true, () => false)))
            return null;
        const list = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        // The ₹ line sits inside the card; click the whole card (nearest clickable ancestor).
        await card.locator('xpath=ancestor::*[self::a or @role="button" or @onclick][1]').click({ timeout: 3000 })
            .catch(() => card.click({ timeout: 3000 }).catch(() => { }));
        await page.waitForFunction(l => { const t = document.body.innerText.replace(/\s+/g, ' '); return t !== l && t.length > 80; }, list, { timeout: 15000 }).catch(() => { });
        const detail = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
        return `List: ${list.slice(0, 400)}\nLatest order detail: ${detail.slice(0, 1500)}`;
    }
    async getOrderPreview() {
        if (!this.page)
            throw new Error('Platform not initialized');
        const cart = await this.getCart();
        if (!cart || cart.items.length === 0)
            return null;
        if (cart.notice)
            throw new Error(`Blinkit checkout unavailable: ${cart.notice}`);
        try {
            // Proceed -> saved-address list -> pick one -> Proceed To Pay -> payment
            // iframe (Zomato paykit). Nothing is charged until a method is confirmed.
            // The checkout list defaults to its first row and marks no selection, so
            // pick the row matching the address chosen via selectAddress (if any).
            // If the cart already has an address attached, the footer shows
            // "Delivering to X" + "Proceed To Pay" and skips the list.
            const payBtn = this.page.getByText(/^Proceed\s+to\s+(?:Pay|Payment)\b/i).last();
            const proceed = this.page.getByText('Proceed', { exact: true }).last();
            const frameEl = this.page.locator('iframe[src*="zpaykit"]').first();
            await proceed.or(payBtn).or(frameEl).filter({ visible: true }).first().waitFor({ timeout: 8000 })
                .catch(() => { throw new Error('Blinkit checkout did not offer Proceed, Proceed to Pay, or a payment panel. Check the cart availability and delivery address before retrying.'); });
            const first = await frameEl.isVisible() ? 'payment' : await payBtn.isVisible() ? 'pay' : 'list';
            let address = '';
            const selected = this.selectedAddress;
            const wanted = selected?.addressLine1.split(',')[0];
            const readFooter = async () => (await this.page.getByText(/Delivering to/).first().locator('xpath=../..').innerText({ timeout: 3000 }).catch(() => ''))
                .replace(/\s*\n\s*/g, ', ').replace(/^.*?Delivering to,?\s*/, '').replace(/,?\s*Change.*$/, '');
            // The cart keeps the address from its last checkout, even after the header
            // location changes, so a stale footer must be switched via "Change".
            let useList = first === 'list';
            if (first === 'pay' || first === 'payment') {
                address = await readFooter();
                if (wanted && !address.toLowerCase().includes(wanted.toLowerCase())) {
                    if (first === 'payment')
                        throw new Error('Blinkit payment panel does not prove the chosen delivery address. Re-select the address before preparing payment.');
                    await this.page.getByText('Change', { exact: true }).last().click({ timeout: 5000 });
                    useList = true;
                }
            }
            if (useList) {
                if (first === 'list')
                    await proceed.click({ timeout: 8000 });
                const all = this.page.locator('[class*="AddressList__AddressLists"] > *');
                await all.first().waitFor({ timeout: 8000 });
                const match = selected ? all.filter({ hasText: wanted }).filter({ hasText: selected.label }) : all;
                if (selected && await match.count() !== 1)
                    throw new Error('The chosen Blinkit address is absent or ambiguous at checkout. Use list_addresses/select_address before retrying.');
                const row = match.first();
                address = (await row.innerText()).replace(/\s*\n\s*/g, ', ');
                await row.click();
            }
            if (first !== 'payment')
                await payBtn.click({ timeout: 8000 });
            await frameEl.waitFor({ timeout: 15000 });
            const frame = this.page.frameLocator('iframe[src*="zpaykit"]').first();
            await frame.getByText(/UPI/).first().waitFor({ timeout: 15000 });
            // Panels are accordions (opening one collapses the other), so open the
            // ones that hide options and accumulate their text.
            let text = await frame.locator('body').innerText();
            for (const title of ['Wallets', 'UPI']) {
                const head = frame.locator('h5', { hasText: new RegExp(`^${title}$`) }).first();
                if (!(await head.count()))
                    continue;
                await head.click({ timeout: 3000 }).catch(() => { });
                await frame.getByText(title === 'UPI' ? /Select UPI APP/i : /LINK|Mobikwik|Paytm/i).first().waitFor({ timeout: 4000 }).catch(() => { });
                text += '\n' + (await frame.locator('body').innerText());
            }
            const paymentMethods = this.scanPaymentMethods(text);
            // The "Cash" panel always carries a "not available below ₹50" note, so
            // trust its enabled state instead (it can be disabled for other reasons too).
            const cash = frame.locator('[role="button"][aria-label="Cash"]').first();
            if ((await cash.count()) && (await cash.getAttribute('aria-disabled')) !== 'true')
                paymentMethods.push('Cash on Delivery');
            return { cart, address, paymentMethods };
        }
        catch (error) {
            console.error('Error getting order preview:', error);
            const body = await this.page.locator('body').innerText().catch(() => '');
            const m = body.match(/[^\n]*(?:not serviceable|unserviceable|not available in your new location|doesn't deliver|not delivering|can't deliver)[^\n]*/i);
            if (m)
                throw new Error(`Address not serviceable on Blinkit: ${m[0].trim()}`);
            // Blinkit drops items it finds out of stock at checkout ("1 out of stock item removed"),
            // so the cart changed under us; the caller must re-read the cart and re-add.
            if (/out of stock items? removed/i.test(body))
                throw new Error('Blinkit removed an out-of-stock item from the cart at checkout; re-check the cart and add the item again or pick another');
            if (/out of stock item/i.test(body))
                throw new Error('Cart has an out-of-stock item on Blinkit; remove it before checkout');
            throw error;
        }
    }
    armedTotal;
    armedCard;
    // CVV comes from env var QC_CVV_<last4> (set in the MCP client's env block); never logged.
    // ponytail: plaintext env var, move to the keychain when hardening.
    readCvv(last4) {
        return process.env[`QC_CVV_${last4}`]?.trim() || undefined;
    }
    /** Saved card: selecting a card and typing the CVV creates no order on Blinkit, so step 1 stops at the ready "Pay Now". */
    async placeCardOrder(confirm, last4) {
        const page = this.page;
        const frame = page.frameLocator('iframe[src*="zpaykit"]').first();
        const payNow = page.getByText(/^Pay Now/).last();
        const cvvInput = frame.locator('input[type="password"]');
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
                return { success: false, message: `No saved card ending ${last4} on Blinkit. Saved: ${preview.paymentMethods.filter(m => m.includes('••')).join(', ') || 'none'}.` };
            // The saved cards sit under the "Add credit or debit cards" accordion.
            const row = frame.getByText(label.split(' ••')[0], { exact: false }).first();
            if (!(await row.isVisible().catch(() => false))) {
                await frame.getByText('Add credit or debit cards', { exact: false }).first().click({ timeout: 5000 });
            }
            await row.click({ timeout: 8000 });
            await cvvInput.fill(cvv, { timeout: 8000 });
            await payNow.waitFor({ timeout: 5000 });
            this.armedTotal = preview.cart.total;
            this.armedCard = label;
            return { success: false, ready: true, total: preview.cart.total, message: `Saved card ${label} selected with CVV filled; stopped before "Pay Now".` };
        }
        if (this.armedTotal === undefined || !this.armedCard)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        const label = this.armedCard;
        this.armedTotal = undefined;
        this.armedCard = undefined; // one shot
        if (!(await cvvInput.inputValue().catch(() => '')) || !(await payNow.isVisible().catch(() => false))) {
            return { success: false, message: 'Checkout screen changed since the preview; nothing was charged. Run the first step again.' };
        }
        await payNow.click({ timeout: 5000 });
        // ponytail: post-payment page (3DS/OTP/success) not observed yet; report what shows.
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        const image = await page.screenshot().catch(() => undefined);
        return { success: true, image, message: `"Pay Now" clicked for ${label}. Page now shows: ${text}` };
    }
    /** UPI collect: fill the VPA, stop before "Checkout" (which sends the request to the phone). */
    async placeUpiOrder(confirm, upiId) {
        const page = this.page;
        const frame = page.frameLocator('iframe[src*="zpaykit"]').first();
        const vpa = frame.locator('input[type="text"]:visible').first();
        const checkout = frame.locator('button:visible', { hasText: /^Checkout$/ }).first();
        if (!confirm) {
            this.armedTotal = undefined;
            if (!upiId || !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upiId))
                return { success: false, message: 'upi_id is required, e.g. name@bank.' };
            const preview = await this.getOrderPreview();
            if (!preview)
                return { success: false, message: 'Could not reach checkout (empty cart?).' };
            await frame.getByText('Add new UPI ID').first().click({ timeout: 5000 });
            await vpa.fill(upiId, { timeout: 5000 });
            await checkout.waitFor({ timeout: 5000 });
            this.armedTotal = preview.cart.total;
            return { success: false, ready: true, total: preview.cart.total, message: `UPI ID entered; stopped before "Checkout" (sends a collect request to ${upiId}).` };
        }
        if (this.armedTotal === undefined)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        this.armedTotal = undefined; // one shot
        if (!(await vpa.inputValue().catch(() => '')) || !(await checkout.isVisible().catch(() => false))) {
            return { success: false, message: 'Checkout screen changed since the preview; nothing was requested. Run the first step again.' };
        }
        await checkout.click({ timeout: 5000 });
        // The user approves on their phone; wait for the page to leave checkout or show an outcome.
        // ponytail: outcome strings are a guess until observed live; raw page text is always returned.
        const outcome = 'order (placed|confirmed)|payment (successful|failed|unsuccessful|declined)|request (expired|declined)|try again';
        const done = await page.waitForFunction((src) => !location.href.includes('checkout') || new RegExp(src, 'i').test(document.body.innerText), outcome, { timeout: 180_000 }).then(() => true, () => false);
        const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        const ok = done && !/fail|declin|expired|try again|unsuccessful/i.test(text);
        return { success: ok, message: done ? `After the collect request, page shows: ${text}` : `No outcome within 3 min (request not approved?). Page shows: ${text}` };
    }
    // detail = UPI ID for 'upi', last 4 digits of a saved card for 'card'.
    async placeOrder(paymentMethod, confirm = false, upiId) {
        if (!this.page)
            throw new Error('Platform not initialized');
        if (paymentMethod === 'wallet')
            return this.placeWalletOrder(confirm, upiId);
        if (paymentMethod === 'upi')
            return this.placeUpiOrder(confirm, upiId);
        if (paymentMethod === 'card')
            return this.placeCardOrder(confirm, upiId);
        if (paymentMethod !== 'cod')
            return { success: false, message: 'Only "cod", "upi" and "card" are supported on Blinkit.' };
        const frame = this.page.frameLocator('iframe[src*="zpaykit"]').first();
        const payNow = this.page.getByText(/^Pay Now/).last();
        if (!confirm) {
            this.armedTotal = undefined;
            const preview = await this.getOrderPreview();
            if (!preview)
                return { success: false, message: 'Could not reach checkout (empty cart?).' };
            if (!preview.paymentMethods.includes('Cash on Delivery')) {
                return { success: false, message: 'Cash on Delivery is not enabled for this cart (Blinkit needs an items subtotal of at least ₹50).' };
            }
            await frame.locator('[role="button"][aria-label="Cash"]').first().click({ timeout: 5000 });
            await frame.getByText(/exact change/i).first().waitFor({ timeout: 8000 });
            await payNow.waitFor({ timeout: 5000 });
            this.armedTotal = preview.cart.total;
            return { success: false, ready: true, total: preview.cart.total, message: 'Cash selected; stopped before "Pay Now".' };
        }
        if (this.armedTotal === undefined)
            return { success: false, message: 'Checkout is not armed; run the first step again.' };
        this.armedTotal = undefined; // one shot, even if the click fails
        // Still on the Cash-selected payment screen?
        const stillThere = await frame.getByText(/exact change/i).first().isVisible().catch(() => false);
        if (!stillThere || !(await payNow.isVisible().catch(() => false))) {
            return { success: false, message: 'Checkout screen changed since the preview; nothing was charged. Run the first step again.' };
        }
        await payNow.click({ timeout: 5000 });
        // ponytail: success signal not yet observed live; report page text for the caller to judge.
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        const text = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        return { success: true, message: `"Pay Now" clicked. Page now shows: ${text}` };
    }
}
//# sourceMappingURL=blinkit.js.map