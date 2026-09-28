import { QuickCommercePlatform, } from './base.js';
import { sessionPath, ensureSessionDir } from '../session-helper.js';
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
        cartItems: '[data-testid="cart-item"], .cart-item, [class*="CartItem"]',
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
    async initialize(context) {
        this.context = context;
        // Session (cookies + localStorage) is restored via storageState when the
        // context is created (see session-helper.ts / index.ts), so nothing to
        // load here.
        this.page = await context.newPage();
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
        // Wait for initial load
        await this.page.waitForTimeout(2000);
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
            const loginButton = await this.page.$(this.selectors.loginButton);
            if (!loginButton) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            const cookies = await this.context.cookies();
            const sessionCookie = cookies.find(c => c.name.includes('session') || c.name.includes('token'));
            if (sessionCookie && sessionCookie.expires && sessionCookie.expires > Date.now() / 1000) {
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
    async submitOtp(otp) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Find and fill OTP input
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (!otpInput) {
                console.log('OTP input not found');
                return false;
            }
            await otpInput.fill(otp);
            // Find and click verify button
            const verifyButton = await this.page.$('button:has-text("Verify"), button:has-text("Submit")');
            if (verifyButton) {
                await verifyButton.click();
                await this.page.waitForTimeout(3000);
            }
            // Check if login succeeded
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
    async search(query, location) {
        if (!this.page)
            throw new Error('Platform not initialized');
        if (!this.isLoggedIn) {
            throw new Error('Not logged in. Please login first.');
        }
        try {
            // The homepage search bar is a link to a dedicated /search page - the
            // actual text input only exists there, not on the homepage itself.
            await this.page.goto(`${this.baseUrl}/search`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const searchInput = await this.page.$(this.selectors.searchInput);
            if (!searchInput) {
                throw new Error('Search input not found');
            }
            await searchInput.click();
            await searchInput.fill(query);
            await this.page.keyboard.press('Enter');
            // Wait for results to load
            await this.page.waitForTimeout(3000);
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
                        quantity: this.extractQuantity(name),
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
    parsePrice(priceText) {
        // Extract numeric value from price text like "₹45", "Rs. 45", "45.00"
        const match = priceText.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1]) : 0;
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
            await addButton.click();
            await this.page.waitForTimeout(1000);
            // Handle quantity if > 1
            if (quantity > 1) {
                for (let i = 1; i < quantity; i++) {
                    const incrementButton = await product.$(this.selectors.incrementButton);
                    if (incrementButton) {
                        await incrementButton.click();
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
    async getCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Navigate to cart
            await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'domcontentloaded' });
            await this.page.waitForTimeout(2000);
            const cartItems = await this.extractCartItems();
            // Calculate totals (simplified - would need actual selectors)
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
            return {
                platform: this.name,
                items: cartItems,
                subtotal,
                deliveryFee: 0, // Would extract from page
                total: subtotal,
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
                    const name = await element.$eval('.item-name, [data-testid="item-name"]', el => el.textContent?.trim() || '');
                    const priceText = await element.$eval('.item-price, [data-testid="item-price"]', el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    const quantityText = await element.$eval('.quantity, [data-testid="quantity"]', el => el.textContent?.trim() || '1');
                    const cartQuantity = parseInt(quantityText) || 1;
                    items.push({
                        id: Math.random().toString(36).substring(7), // Would extract actual ID
                        name,
                        price,
                        platform: this.name,
                        quantity: '1 unit',
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
        // Implementation similar to addToCart
        console.log('Remove from cart not yet implemented');
        return false;
    }
    async clearCart() {
        // Would loop through cart items and remove all
        console.log('Clear cart not yet implemented');
        return false;
    }
    async getAddresses() {
        // Would navigate to address page and extract addresses
        console.log('Get addresses not yet implemented');
        return [];
    }
    async selectAddress(addressId) {
        console.log('Select address not yet implemented');
        return false;
    }
    async getOrderPreview() {
        const cart = await this.getCart();
        if (!cart)
            return null;
        return {
            cart,
            address: null, // Would extract from page
            paymentMethods: ['Wallet', 'UPI', 'Card'],
        };
    }
    async placeOrder(paymentMethod) {
        console.log('Place order not yet implemented - requires user confirmation');
        return {
            success: false,
            message: 'Order placement requires manual confirmation for safety',
        };
    }
}
//# sourceMappingURL=zepto.js.map