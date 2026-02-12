import { QuickCommercePlatform, } from './base.js';
export class SwiggyInstamartPlatform extends QuickCommercePlatform {
    selectors = {
        // Swiggy Instamart specific selectors - these need testing
        searchInput: 'input[data-testid="autosuggest-input"], input[placeholder*="Search"], input[class*="search"]',
        searchResults: '[data-testid="item-card"], div[class*="item-card"], [class*="InstamartItemCard"]',
        productName: '[data-testid="item-name"], span[class*="itemName"], div[class*="itemName"]',
        productPrice: '[data-testid="item-price"], div[class*="price"], span[class*="price"]',
        productMRP: '[data-testid="item-mrp"], div[class*="mrp"], span[class*="strikethrough"]',
        addToCartButton: 'button[class*="addBtn"], button:has-text("ADD"), [data-testid="add-button"]',
        quantitySelector: 'button[class*="increment"], button:has-text("+"), [data-testid="increment"]',
        cartIcon: 'button:has-text("Cart"), a:has-text("Cart"), [data-testid="cart-button"]',
        cartItems: '[data-testid="cart-item"], div[class*="cart-item"]',
        loginPhoneInput: 'input[type="tel"], input[name="mobile"], input[placeholder*="Phone"]',
        otpInput: 'input[type="number"], input[name="otp"], input[placeholder*="OTP"]',
        addressSelector: '[data-testid="address"], div[class*="address"]',
        deliveryTime: 'span[class*="deliveryTime"], div[class*="deliveryTime"]',
    };
    constructor() {
        super('swiggy-instamart', 'https://www.swiggy.com/instamart');
    }
    async initialize(context) {
        this.context = context;
        this.page = await context.newPage();
        // Set viewport to wide enough for Instamart
        await this.page.setViewportSize({ width: 1280, height: 800 });
        // Navigate to Instamart
        await this.page.goto(this.baseUrl, { waitUntil: 'networkidle' });
        // Wait for page to load
        await this.page.waitForTimeout(3000);
        // Handle location popup if it appears
        await this.handleLocationPopup();
    }
    async handleLocationPopup() {
        if (!this.page)
            return;
        try {
            // Swiggy often shows a delivery location popup
            const detectLocationBtn = await this.page.$('button:has-text("Detect my location"), button[class*="detect-location"]');
            if (detectLocationBtn) {
                // Don't click auto-detect, let user handle location or use saved addresses
                console.log('Location popup detected - user will need to set location');
            }
        }
        catch {
            // No popup, that's fine
        }
    }
    async checkLogin() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Check for logged in state - usually there's an account icon
            const accountBtn = await this.page.$('button:has-text("Account"), div[class*="account"], [data-testid="account"]');
            const loginBtn = await this.page.$('button:has-text("Log in"), button:has-text("LOGIN")');
            if (accountBtn && !loginBtn) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            // Check session storage/cookies
            const cookies = await this.context.cookies();
            const swiggySession = cookies.find(c => c.name.includes('session') ||
                c.name.includes('token') ||
                c.name.includes('swiggy'));
            if (swiggySession && swiggySession.expires && swiggySession.expires > Date.now() / 1000) {
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
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (!otpInput) {
                console.log('OTP input not found');
                return false;
            }
            await otpInput.fill(otp);
            // Find verify/submit button
            const verifyBtn = await this.page.$('button:has-text("Verify"), button:has-text("SUBMIT"), button[class*="verify"]');
            if (verifyBtn) {
                await verifyBtn.click();
                await this.page.waitForTimeout(3000);
            }
            // Check if login succeeded
            const loginCheck = await this.checkLogin();
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
        try {
            // Ensure delivery location is set first
            if (location) {
                await this.setDeliveryLocation(location);
            }
            // Click on search input
            const searchInput = await this.page.$(this.selectors.searchInput);
            if (!searchInput) {
                throw new Error('Search input not found');
            }
            await searchInput.click();
            await searchInput.fill(query);
            await this.page.keyboard.press('Enter');
            // Wait for search results
            await this.page.waitForTimeout(3000);
            // Wait for results to appear
            try {
                await this.page.waitForSelector(this.selectors.searchResults, { timeout: 10000 });
            }
            catch {
                console.log('Search results selector not found, trying fallback');
            }
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
    async setDeliveryLocation(pincode) {
        if (!this.page)
            return;
        try {
            // Check if we need to set location
            const locationBtn = await this.page.$('div[class*="location"], button[class*="location"]');
            if (locationBtn) {
                await locationBtn.click();
                await this.page.waitForTimeout(1000);
                // Look for search by pincode
                const pincodeInput = await this.page.$('input[placeholder*="Enter pincode"], input[placeholder*="Search"]');
                if (pincodeInput) {
                    await pincodeInput.fill(pincode);
                    await this.page.keyboard.press('Enter');
                    await this.page.waitForTimeout(2000);
                }
            }
        }
        catch (error) {
            console.error('Error setting location:', error);
        }
    }
    async extractProductResults() {
        if (!this.page)
            return [];
        const products = [];
        try {
            const productElements = await this.page.$$(this.selectors.searchResults);
            for (const element of productElements.slice(0, 20)) {
                try {
                    const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
                    const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    // Try to get MRP (strikethrough price)
                    let mrp;
                    try {
                        const mrpText = await element.$eval(this.selectors.productMRP, el => el.textContent?.trim());
                        mrp = this.parsePrice(mrpText || '');
                    }
                    catch {
                        mrp = undefined;
                    }
                    // Try to get delivery time estimate
                    let deliveryTime;
                    try {
                        deliveryTime = await element.$eval(this.selectors.deliveryTime, el => el.textContent?.trim());
                    }
                    catch {
                        deliveryTime = undefined;
                    }
                    const productId = await element.evaluate(el => {
                        return el.getAttribute('data-item-id') ||
                            el.getAttribute('data-testid') ||
                            el.getAttribute('id') ||
                            Math.random().toString(36).substring(7);
                    });
                    products.push({
                        id: productId,
                        name: name || 'Unknown Product',
                        price,
                        mrp,
                        quantity: this.extractQuantity(name),
                        deliveryTime,
                        platform: this.name,
                        inStock: true,
                    });
                }
                catch {
                    // Skip failed products
                }
            }
        }
        catch (error) {
            console.error('Error extracting products:', error);
        }
        return products;
    }
    parsePrice(priceText) {
        const match = priceText.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1]) : 0;
    }
    extractQuantity(name) {
        const match = name.match(/(\d+\s*(?:ml|L|g|kg|pcs|pack))/i);
        return match ? match[1] : '1 unit';
    }
    async addToCart(productId, quantity) {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Find product
            const product = await this.page.$(`[data-item-id="${productId}"], [id="${productId}"]`);
            if (!product) {
                console.log('Product not found:', productId);
                return false;
            }
            const addButton = await product.$(this.selectors.addToCartButton);
            if (!addButton) {
                console.log('Add button not found');
                return false;
            }
            await addButton.click();
            await this.page.waitForTimeout(1000);
            // Handle quantity increase
            if (quantity > 1) {
                for (let i = 1; i < quantity; i++) {
                    const incrementBtn = await product.$(this.selectors.quantitySelector);
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
    async getCart() {
        if (!this.page)
            throw new Error('Platform not initialized');
        try {
            // Click cart button to open cart
            const cartBtn = await this.page.$(this.selectors.cartIcon);
            if (cartBtn) {
                await cartBtn.click();
                await this.page.waitForTimeout(2000);
            }
            const cartItems = await this.extractCartItems();
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
            return {
                platform: this.name,
                items: cartItems,
                subtotal,
                deliveryFee: 0, // Extract from page
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
                    const name = await element.$eval('div[class*="itemName"], span[class*="itemName"]', el => el.textContent?.trim() || '');
                    const priceText = await element.$eval('div[class*="price"], span[class*="price"]', el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    const quantityText = await element.$eval('div[class*="quantity"], span[class*="qty"]', el => el.textContent?.trim() || '1');
                    const cartQuantity = parseInt(quantityText) || 1;
                    items.push({
                        id: Math.random().toString(36).substring(7),
                        name,
                        price,
                        platform: this.name,
                        quantity: '1 unit',
                        inStock: true,
                        cartQuantity,
                    });
                }
                catch {
                    // Skip failed items
                }
            }
        }
        catch (error) {
            console.error('Error extracting cart items:', error);
        }
        return items;
    }
    async removeFromCart(productId) {
        console.log('Remove from cart not yet implemented');
        return false;
    }
    async clearCart() {
        console.log('Clear cart not yet implemented');
        return false;
    }
    async getAddresses() {
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
            address: null,
            paymentMethods: ['Wallet', 'UPI', 'Card'],
        };
    }
    async placeOrder(paymentMethod) {
        console.log('Place order requires manual confirmation');
        return {
            success: false,
            message: 'Order placement requires manual confirmation for safety',
        };
    }
}
//# sourceMappingURL=swiggy-instamart.js.map