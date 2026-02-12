import { QuickCommercePlatform } from '../platforms/base.js';
import { ResilientSelectorEngine } from '../engine/resilient-selector.js';
export class BulletproofZeptoPlatform extends QuickCommercePlatform {
    selectorEngine;
    constructor() {
        super('zepto', 'https://www.zeptonow.com');
        this.selectorEngine = new ResilientSelectorEngine();
    }
    async initialize(context) {
        this.context = context;
        this.page = await context.newPage();
        this.selectorEngine.setPage(this.page);
        // Enhanced stealth settings
        await this.page.setViewportSize({ width: 390, height: 844 });
        // Use stealth headers
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        });
        await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(3000);
        // Auto-discover selectors for critical elements
        await this.discoverCriticalSelectors();
    }
    /**
     * Auto-discover and cache selectors for critical UI elements
     */
    async discoverCriticalSelectors() {
        console.log('🔍 Auto-discovering selectors...');
        const criticalElements = ['search', 'login', 'cart'];
        for (const purpose of criticalElements) {
            const found = await this.selectorEngine.findElementWithFallback(purpose);
            if (found) {
                console.log(`✅ Found ${purpose}: ${found.selector} (confidence: auto-discovered)`);
            }
            else {
                console.log(`⚠️ Could not auto-discover ${purpose} selector`);
            }
        }
    }
    async checkLogin() {
        if (!this.page || !this.selectorEngine.getPage()) {
            throw new Error('Platform not initialized');
        }
        try {
            // Try to discover login button dynamically
            const loginElement = await this.selectorEngine.findElementWithFallback('login');
            if (!loginElement) {
                // No login button found - likely already logged in
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            // Check for OTP input (indicates OTP was sent but not entered)
            const otpElement = await this.selectorEngine.findElementWithFallback('otp');
            if (otpElement) {
                // Extract phone number if displayed
                const phone = await this.extractPhoneNumber();
                return { loggedIn: false, otpSent: true, phone };
            }
            this.isLoggedIn = false;
            return { loggedIn: false };
        }
        catch (error) {
            console.log('Login check recovered from error, assuming not logged in');
            return { loggedIn: false };
        }
    }
    async extractPhoneNumber() {
        if (!this.page)
            return undefined;
        try {
            // Look for partial phone number on the page (masked as *******1234)
            const pageText = await this.page.content();
            const match = pageText.match(/(\*{7,}\d{4}|\+91[\d\s-]{10}|\d{10})/);
            return match ? `+91${match[0].slice(-10)}` : undefined;
        }
        catch {
            return undefined;
        }
    }
    async submitOtp(otp) {
        const otpElement = await this.selectorEngine.findElementWithFallback('otp');
        if (!otpElement) {
            console.log('Could not find OTP input');
            return false;
        }
        try {
            await otpElement.element.fill(otp);
            // Look for verify button
            const verifyBtn = await this.findButtonByText(['Verify', 'Submit', 'Continue', 'Confirm']);
            if (verifyBtn) {
                await verifyBtn.click();
                await this.page.waitForTimeout(3000);
            }
            return (await this.checkLogin()).loggedIn;
        }
        catch {
            return false;
        }
    }
    async search(query, location) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Ensure logged in
            const login = await this.checkLogin();
            if (!login.loggedIn) {
                return {
                    query,
                    platform: this.name,
                    products: [],
                    totalResults: 0,
                    error: 'Requires login. OTP would be sent to your phone.',
                };
            }
            // Find search input using resilient engine
            const searchResult = await this.selectorEngine.findElementWithFallback('search');
            if (!searchResult) {
                throw new Error('Could not find search input');
            }
            // Interact with search
            await searchResult.element.click();
            await searchResult.element.fill(query);
            // Submit search
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(3000);
            // Discover product elements
            const products = await this.discoverProducts();
            return {
                query,
                platform: this.name,
                products,
                totalResults: products.length,
            };
        }
        catch (error) {
            console.error('Search error:', error);
            return {
                query,
                platform: this.name,
                products: [],
                totalResults: 0,
                error: error.message,
            };
        }
    }
    /**
     * Intelligently discover products on the page
     */
    async discoverProducts() {
        if (!this.page)
            return [];
        const products = [];
        // Try AI-powered discovery first
        const productElement = await this.selectorEngine.findElementWithFallback('product');
        if (!productElement) {
            // Fallback: manual scanning
            return this.manualProductScan();
        }
        // Get all products of this type
        const selector = productElement.selector;
        const elements = await this.page.$$(selector);
        for (const element of elements.slice(0, 20)) {
            try {
                const product = await this.extractProductData(element);
                if (product)
                    products.push(product);
            }
            catch {
                // Skip failed products
            }
        }
        return products;
    }
    /**
     * Manual product scanning as fallback
     */
    async manualProductScan() {
        if (!this.page)
            return [];
        const products = [];
        // Generic product selectors that work across many sites
        const genericSelectors = [
            'article',
            'div[class*="product"]',
            'div[class*="item"]',
            'div[class*="card"]',
            '[data-testid]',
            'li',
        ];
        for (const selector of genericSelectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements.slice(0, 10)) {
                try {
                    const product = await this.extractProductData(element);
                    if (product && !products.find(p => p.name === product.name)) {
                        products.push(product);
                    }
                }
                catch {
                    // Skip
                }
            }
            if (products.length >= 10)
                break; // Got enough
        }
        return products;
    }
    /**
     * Extract product data from element using multiple strategies
     */
    async extractProductData(element) {
        try {
            // Strategy 1: Try to find name
            const name = await this.findProductName(element);
            if (!name)
                return null;
            // Strategy 2: Try to find price
            const price = await this.findProductPrice(element);
            // Strategy 3: Try to find MRP
            const mrp = await this.findProductMRP(element);
            // Strategy 4: Check stock status
            const inStock = await this.checkStockStatus(element);
            // Generate unique ID
            const id = await element.evaluate((el) => el.getAttribute('data-product-id') ||
                el.getAttribute('data-variant-id') ||
                el.getAttribute('id') ||
                Math.random().toString(36).substring(2, 9));
            return {
                id,
                name,
                price,
                mrp,
                platform: this.name,
                quantity: this.extractQuantity(name),
                inStock,
            };
        }
        catch {
            return null;
        }
    }
    async findProductName(element) {
        const strategies = [
            'h1, h2, h3, h4',
            '[class*="name"], [class*="title"]',
            '[data-testid*="name"], [data-testid*="title"]',
            'span[class]',
            'div[class]',
        ];
        for (const selector of strategies) {
            try {
                const name = await element.$eval(selector, (el) => {
                    const text = el.textContent?.trim();
                    // Filter out very short or obvious non-product text
                    if (text && text.length > 3 && text.length < 200 && !text.includes('₹')) {
                        return text;
                    }
                });
                if (name)
                    return name;
            }
            catch {
                // Continue to next strategy
            }
        }
        return null;
    }
    async findProductPrice(element) {
        const priceElement = await this.selectorEngine.findElementWithFallback('price');
        if (priceElement && await this.isDescendant(element, priceElement.element)) {
            const text = await priceElement.element.innerText();
            return this.parsePrice(text);
        }
        // Fallback: search within element for price patterns
        try {
            const text = await element.innerText();
            const match = text.match(/₹\s*(\d+(?:\.\d{2})?)/);
            return match ? parseFloat(match[1]) : 0;
        }
        catch {
            return 0;
        }
    }
    async findProductMRP(element) {
        try {
            const text = await element.innerText();
            // Look for strikethrough or MRP format
            const matches = text.match(/(?:MRP|~)?\s*₹\s*(\d+(?:\.\d{2})?)/g);
            if (matches && matches.length > 1) {
                // First is usually current price, second is MRP
                return this.parsePrice(matches[1]);
            }
        }
        catch {
            // Return undefined
        }
        return undefined;
    }
    async checkStockStatus(element) {
        try {
            const text = await element.innerText();
            const outOfStockTerms = ['out of stock', 'unavailable', 'sold out', 'coming soon'];
            return !outOfStockTerms.some(term => text.toLowerCase().includes(term));
        }
        catch {
            return true; // Assume in stock
        }
    }
    async isDescendant(parent, child) {
        try {
            return await parent.evaluate((parentEl, childEl) => {
                return parentEl.contains(childEl);
            }, child);
        }
        catch {
            return false;
        }
    }
    findButtonByText(texts) {
        if (!this.page)
            return Promise.resolve(null);
        const selector = texts.map(t => `button:has-text("${t}")`).join(', ');
        return this.page.$(selector);
    }
    parsePrice(text) {
        const match = text.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1]) : 0;
    }
    extractQuantity(name) {
        const match = name.match(/(\d+(?:\.\d+)?\s*(?:ml|L|g|kg|pcs|pack|bottle|can)s?)/i);
        return match ? match[1] : '1 unit';
    }
    // ... other methods (addToCart, getCart, etc.) follow similar pattern
    async addToCart(productId, quantity) {
        // Implementation using resilient selectors
        return false; // Placeholder
    }
    async getCart() {
        return null; // Placeholder
    }
    async removeFromCart(productId) {
        return false;
    }
    async clearCart() {
        return false;
    }
    async getAddresses() {
        return [];
    }
    async selectAddress(addressId) {
        return false;
    }
    async getOrderPreview() {
        return null;
    }
    async placeOrder(paymentMethod) {
        return {
            success: false,
            message: 'Order placement requires manual confirmation',
        };
    }
}
//# sourceMappingURL=bulletproof-zepto.js.map