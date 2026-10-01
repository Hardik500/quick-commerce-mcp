import { QuickCommercePlatform, } from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';
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
        // Wait for page to stabilize
        await this.page.waitForTimeout(2000);
        // Handle any initial popups (app-install interstitial, location prompt)
        await this.handleInitialPopups();
    }
    async handleInitialPopups() {
        if (!this.page)
            return;
        try {
            // "Get the app" interstitial shown on every fresh page load.
            const continueOnWeb = await this.page.$(this.selectors.continueOnWebLink);
            if (continueOnWeb) {
                await continueOnWeb.click();
                await this.page.waitForTimeout(1500);
            }
            // "Select your location" modal - only appears if the session has no
            // saved location yet (a fresh/expired login).
            const useLocationBtn = await this.page.$(this.selectors.useLocationButton);
            if (useLocationBtn) {
                await useLocationBtn.click();
                await this.page.waitForTimeout(2000);
            }
        }
        catch {
            // Popups might not appear, that's fine
        }
    }
    async checkLogin() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // gr_1_accessToken is Blinkit's auth cookie (gr_1 = legacy Grofers
            // brand prefix) - present only once phone+OTP login succeeds.
            const cookies = await this.context.cookies();
            const authCookie = cookies.find(c => c.name === 'gr_1_accessToken');
            if (authCookie && authCookie.value) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            // If a login flow was already triggered (e.g. by a prior submitOtp
            // attempt) and the OTP screen is showing, report that back so the
            // caller can prompt for the code instead of just "not logged in".
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (otpInput) {
                this.isLoggedIn = false;
                return { loggedIn: false, otpSent: true };
            }
            this.isLoggedIn = false;
            return { loggedIn: false };
        }
        catch (error) {
            console.error('Error checking login status:', error);
            return { loggedIn: false };
        }
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
            await this.page.waitForTimeout(3000);
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
    async search(query, location) {
        if (!this.page)
            throw new Error('Platform not initialized');
        if (!this.isLoggedIn) {
            throw new Error('Not logged in. Please login first.');
        }
        try {
            // Delivery location comes from the saved session (set during login);
            // the /s/?q= search page doesn't take a location override, so the
            // `location` param is accepted for interface parity but unused here.
            await this.page.goto(`${this.baseUrl}/s/?q=${encodeURIComponent(query)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            // Results render after a skeleton that can outlast a fixed delay on a
            // cold page; a timeout here just means no results.
            await this.page.waitForSelector(this.selectors.productName, { timeout: 15000 }).catch(() => { });
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
            const product = await this.page.$(`div[id="${productId}"]`);
            if (!product) {
                console.log('Product not found:', productId);
                return false;
            }
            // Click add button
            const addButton = await product.$(this.selectors.addToCartButton);
            if (!addButton) {
                console.log('Add to cart button not found');
                return false;
            }
            await addButton.click();
            await this.page.waitForTimeout(1000);
            // Handle quantity increment if quantity > 1 (ADD button turns into a
            // -/qty/+ stepper after the first click).
            if (quantity > 1) {
                for (let i = 1; i < quantity; i++) {
                    const incrementBtn = await product.$(this.selectors.incrementButton);
                    if (incrementBtn) {
                        await incrementBtn.click();
                        await this.page.waitForTimeout(500);
                    }
                }
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
        await this.page.waitForTimeout(3000);
    }
    async getCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            await this.openCart();
            const cartItems = await this.extractCartItems();
            // Bill rows (Items total / Delivery charge / Handling charge / Grand
            // total) share one container; match by label text next to it.
            const billValue = async (label) => {
                const row = this.page.locator(this.selectors.billRow).filter({
                    has: this.page.locator(this.selectors.billLabel, { hasText: label }),
                });
                const text = await row.locator(this.selectors.billValue).first().textContent().catch(() => null);
                return text ? this.parsePrice(text) : 0;
            };
            const subtotal = await billValue('Items total');
            const total = await billValue('Grand total');
            return {
                platform: this.name,
                items: cartItems,
                subtotal: subtotal || cartItems.reduce((sum, item) => sum + item.price * item.cartQuantity, 0),
                deliveryFee: total && subtotal ? total - subtotal : 0,
                total: total || subtotal,
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
                // First pass: the drawer may still be rendering; wait for the row.
                if (i === 0)
                    await row.waitFor({ timeout: 5000 }).catch(() => { });
                if ((await row.count()) === 0)
                    return i > 0;
                await row.locator(this.selectors.cartStepperMinus).click();
                await this.page.waitForTimeout(1000);
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
                const minus = await this.page.$(`${this.selectors.cartItems} ${this.selectors.cartStepperMinus}`);
                if (!minus)
                    return true;
                await minus.click();
                await this.page.waitForTimeout(1000);
            }
            return false;
        }
        catch (error) {
            console.error('Error clearing cart:', error);
            return false;
        }
    }
    async getAddresses() {
        // Would navigate to addresses section
        console.log('Get addresses not yet fully implemented');
        return [];
    }
    async selectAddress(addressId) {
        console.log('Select address not yet fully implemented');
        return false;
    }
    async getOrderPreview() {
        const cart = await this.getCart();
        if (!cart)
            return null;
        return {
            cart,
            address: null,
            paymentMethods: ['Wallet', 'UPI', 'Card', 'Cash on Delivery'],
        };
    }
    async placeOrder(paymentMethod) {
        // Safety: Never auto-place orders
        return {
            success: false,
            message: 'Order placement requires manual confirmation for safety',
        };
    }
}
//# sourceMappingURL=blinkit.js.map