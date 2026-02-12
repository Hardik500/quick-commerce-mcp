import { QuickCommercePlatform, } from './base.js';
export class BlinkitPlatform extends QuickCommercePlatform {
    selectors = {
        // Blinkit specific selectors
        searchInput: 'input[placeholder*="Search"], input[data-testid="search-input"], input[type="search"]',
        searchResults: '[data-testid="product-card"], div[class*="ProductCard"], div[class*="product-card"]',
        productName: '[data-testid="product-name"], h3, h4, div[class*="ProductName"], span[class*="name"]',
        productPrice: '[data-testid="price"], div[class*="Price"], span[class*="price-current"]',
        productMRP: '[data-testid="mrp"], div[class*="MRP"], span[class*="price-original"]',
        discount: '[data-testid="discount"], span[class*="discount"], span[class*="Discount"]',
        addToCartButton: 'button:has-text("ADD"), button[class*="add"], [data-testid="add-button"]',
        quantityIncrement: 'button:has-text("+"), [data-testid="increment"], [aria-label*="increase"]',
        quantityDecrement: 'button:has-text("-"), [data-testid="decrement"], [aria-label*="decrease"]',
        cartIcon: 'button:has-text("Cart"), a[href*="cart"], [data-testid="cart"]',
        cartItems: '[data-testid="cart-item"], div[class*="CartItem"], div[class*="cart-item"]',
        productImage: 'img[class*="product-image"], div[class*="ProductImage"] img',
        availability: '[data-testid="out-of-stock"], span[class*="out-of-stock"], div[class*="unavailable"]',
        deliveryTime: '[data-testid="delivery-time"], span[class*="delivery"], div[class*="time"]',
        loginButton: 'button:has-text("Login"), button:has-text("Sign in"), a:has-text("Login")',
        phoneInput: 'input[type="tel"], input[placeholder*="phone"], input[name="mobile"]',
        otpInput: 'input[placeholder*="OTP"], input[type="number"][maxlength="6"]',
        addressDropdown: 'div[class*="address-selector"], button[class*="address"]',
        addressItem: '[data-testid="address-item"], div[class*="SavedAddress"]',
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
        await this.page.goto(this.baseUrl, { waitUntil: 'networkidle' });
        // Wait for page to stabilize
        await this.page.waitForTimeout(2000);
        // Handle any initial popups (location, notifications)
        await this.handleInitialPopups();
    }
    async handleInitialPopups() {
        if (!this.page)
            return;
        try {
            // Handle location permission popup
            const allowLocationBtn = await this.page.$('button:has-text("Allow")');
            if (allowLocationBtn) {
                await allowLocationBtn.click();
                await this.page.waitForTimeout(1000);
            }
            // Handle notification popup
            const notNowBtn = await this.page.$('button:has-text("Not now"), button:has-text("Block")');
            if (notNowBtn) {
                await notNowBtn.click();
                await this.page.waitForTimeout(500);
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
            // Check for profile/account button (indicates logged in)
            const profileButton = await this.page.$('button[class*="profile"], div[class*="Profile"], [data-testid="profile"]');
            const loginButton = await this.page.$(this.selectors.loginButton);
            if (profileButton && !loginButton) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            // Check cookies
            const cookies = await this.context.cookies();
            const authCookie = cookies.find(c => c.name.includes('auth') ||
                c.name.includes('token') ||
                c.name.includes('session') ||
                c.name.includes('blinkit'));
            if (authCookie && authCookie.expires && authCookie.expires > Date.now() / 1000) {
                this.isLoggedIn = true;
                return { loggedIn: true };
            }
            // Check if there's an OTP input visible (indicates OTP sent)
            const otpInput = await this.page.$(this.selectors.otpInput);
            if (otpInput) {
                this.isLoggedIn = false;
                return {
                    loggedIn: false,
                    otpSent: true,
                    phone: await this.extractPhoneNumber()
                };
            }
            this.isLoggedIn = false;
            return { loggedIn: false };
        }
        catch (error) {
            console.error('Error checking login status:', error);
            return { loggedIn: false };
        }
    }
    async extractPhoneNumber() {
        if (!this.page)
            return undefined;
        try {
            // Try to find phone number displayed on page
            const phoneElement = await this.page.$('span[class*="phone"], div[class*="phone-number"]');
            if (phoneElement) {
                const phone = await phoneElement.textContent();
                return phone?.replace(/\D/g, '').slice(-10); // Last 10 digits
            }
        }
        catch {
            // Ignore
        }
        return undefined;
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
            // Submit OTP (usually auto-submits or has a button)
            await this.page.waitForTimeout(500);
            // Try clicking verify button if present
            const verifyButton = await this.page.$('button:has-text("Verify"), button:has-text("Submit"), button[type="submit"]');
            if (verifyButton) {
                await verifyButton.click();
                await this.page.waitForTimeout(3000);
            }
            else {
                // Wait for auto-submit
                await this.page.waitForTimeout(3000);
            }
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
            // Set location if provided
            if (location) {
                await this.setLocation(location);
            }
            // Find and use search input
            const searchInput = await this.page.$(this.selectors.searchInput);
            if (!searchInput) {
                throw new Error('Search input not found');
            }
            await searchInput.click();
            await searchInput.fill(query);
            await this.page.keyboard.press('Enter');
            // Wait for results
            await this.page.waitForTimeout(3000);
            // Wait for product cards to appear
            try {
                await this.page.waitForSelector(this.selectors.searchResults, { timeout: 5000 });
            }
            catch {
                console.log('Search results not found, trying to extract anyway');
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
    async setLocation(pincodeOrArea) {
        if (!this.page)
            return;
        try {
            // Check if location selector is accessible
            const locationBtn = await this.page.$(this.selectors.addressDropdown);
            if (locationBtn) {
                await locationBtn.click();
                await this.page.waitForTimeout(1000);
                // Search for location
                const searchInput = await this.page.$('input[placeholder*="Search location"], input[placeholder*="area"]');
                if (searchInput) {
                    await searchInput.fill(pincodeOrArea);
                    await this.page.keyboard.press('Enter');
                    await this.page.waitForTimeout(2000);
                    // Select first result
                    const firstResult = await this.page.$('div[class*="suggestion"], li[class*="result"]:first-child');
                    if (firstResult) {
                        await firstResult.click();
                        await this.page.waitForTimeout(2000);
                    }
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
                    // Check for discount
                    let discount;
                    try {
                        discount = await element.$eval(this.selectors.discount, el => el.textContent?.trim() || undefined);
                    }
                    catch {
                        discount = undefined;
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
                    // Extract unique ID
                    const productId = await element.evaluate(el => {
                        return el.getAttribute('data-product-id') ||
                            el.getAttribute('data-variant-id') ||
                            el.getAttribute('id') ||
                            Math.random().toString(36).substring(2, 9);
                    });
                    products.push({
                        id: productId,
                        name: name || 'Unknown Product',
                        price,
                        mrp,
                        discount,
                        quantity: this.extractQuantity(name),
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
    parsePrice(priceText) {
        // Extract numeric value from strings like "₹45", "₹ 45.00", "Rs 45"
        const match = priceText.match(/[₹Rs.]?\s*(\d+(?:\.\d{2})?)/i);
        return match ? parseFloat(match[1]) : 0;
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
            // Find product element
            const product = await this.page.$(`[data-product-id="${productId}"], [id="${productId}"]`);
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
            // Handle quantity increment if quantity > 1
            if (quantity > 1) {
                for (let i = 1; i < quantity; i++) {
                    const incrementBtn = await product.$(this.selectors.quantityIncrement);
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
            // Click cart button
            const cartBtn = await this.page.$(this.selectors.cartIcon);
            if (cartBtn) {
                await cartBtn.click();
                await this.page.waitForTimeout(2000);
            }
            else {
                // Navigate directly to cart
                await this.page.goto(`${this.baseUrl}/cart`, { waitUntil: 'networkidle' });
                await this.page.waitForTimeout(2000);
            }
            const cartItems = await this.extractCartItems();
            const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
            // Try to extract delivery fee from page
            let deliveryFee = 0;
            try {
                const feeText = await this.page.$eval('div[class*="delivery"], span[class*="delivery-fee"]', el => el.textContent);
                if (feeText) {
                    deliveryFee = this.parsePrice(feeText);
                }
            }
            catch {
                // Default to 0 if can't extract
            }
            return {
                platform: this.name,
                items: cartItems,
                subtotal,
                deliveryFee,
                total: subtotal + deliveryFee,
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
                    const name = await element.$eval(this.selectors.productName, el => el.textContent?.trim() || '');
                    const priceText = await element.$eval(this.selectors.productPrice, el => el.textContent?.trim() || '');
                    const price = this.parsePrice(priceText);
                    // Get quantity
                    let cartQuantity = 1;
                    try {
                        const qtyText = await element.$eval('span[class*="quantity"], div[class*="qty"]', el => el.textContent?.trim());
                        if (qtyText) {
                            cartQuantity = parseInt(qtyText) || 1;
                        }
                    }
                    catch {
                        // Default to 1
                    }
                    items.push({
                        id: Math.random().toString(36).substring(2, 9),
                        name,
                        price,
                        platform: this.name,
                        quantity: '1 unit',
                        inStock: true,
                        cartQuantity,
                    });
                }
                catch (err) {
                    // Skip item
                }
            }
        }
        catch (error) {
            console.error('Error extracting cart items:', error);
        }
        return items;
    }
    async removeFromCart(productId) {
        // Would implement decrement quantity or remove
        console.log('Remove from cart not yet fully implemented');
        return false;
    }
    async clearCart() {
        // Would iterate and remove all items
        console.log('Clear cart not yet fully implemented');
        return false;
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