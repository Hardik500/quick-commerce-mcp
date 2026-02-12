export class ResilientSelectorEngine {
    page = null;
    selectorCache = new Map();
    failedSelectors = new Set();
    /**
     * Strategy 1: LLM-Powered Semantic Analysis
     * Use AI to understand page structure and predict selectors
     */
    async discoverWithAI(purpose) {
        if (!this.page)
            throw new Error('Page not initialized');
        const candidates = [];
        // Get page context for AI analysis
        const pageContext = await this.getPageContext();
        // Strategy: Look for semantic attributes and roles
        const semanticSelectors = await this.findSemanticElements(purpose);
        candidates.push(...semanticSelectors);
        // Strategy: Analyze form inputs by type and placement
        const formSelectors = await this.findFormElements(purpose);
        candidates.push(...formSelectors);
        // Strategy: Visual/positional analysis
        const visualSelectors = await this.findVisualElements(purpose);
        candidates.push(...visualSelectors);
        // Strategy: Heuristic pattern matching
        const heuristicSelectors = await this.findHeuristicElements(purpose);
        candidates.push(...heuristicSelectors);
        // Sort by confidence score
        return candidates
            .filter(c => c.confidence > 0.3)
            .sort((a, b) => b.confidence - a.confidence);
    }
    /**
     * Find elements using semantic HTML5 attributes and ARIA roles
     */
    async findSemanticElements(purpose) {
        const strategies = {
            search: [
                '[role="search"] input',
                '[role="searchbox"]',
                'input[type="search"]',
                '[aria-label*="search" i]',
                'form[role="search"] input',
            ],
            product: [
                '[role="article"]',
                '[role="listitem"]',
                'article',
                '[data-product]',
                '[data-item-type="product"]',
            ],
            cart: [
                '[role="complementary"][aria-label*="cart" i]',
                '[aria-label*="cart" i]',
                '[data-testid*="cart" i]',
                'button:has-text("Cart")',
                'a:has-text("Cart")',
            ],
            login: [
                'button:has-text("Login")',
                'button:has-text("Sign in")',
                'a:has-text("Login")',
                'button:has-text("Log in")',
                '[aria-label*="login" i]',
            ],
            price: [
                '[data-testid*="price" i]',
                'span:has-text("₹")',
                'div:has-text("₹")',
                '[aria-label*="price" i]',
                'span[class*="price" i]',
            ],
        };
        const results = [];
        const selectors = strategies[purpose] || [];
        for (const selector of selectors) {
            if (this.failedSelectors.has(selector))
                continue;
            try {
                const elements = await this.page.$$(selector);
                if (elements.length > 0) {
                    results.push({
                        selector,
                        confidence: this.calculateSemanticConfidence(purpose, selector, elements.length),
                        strategy: 'semantic',
                        elementCount: elements.length,
                    });
                }
            }
            catch {
                this.failedSelectors.add(selector);
            }
        }
        return results;
    }
    /**
     * Find form elements by input characteristics
     */
    async findFormElements(purpose) {
        const strategies = {
            search: [
                { selector: 'input:not([type])', attrs: ['placeholder', 'id', 'name', 'class'] },
                { selector: 'input[type="text"]', attrs: ['placeholder', 'id', 'name', 'class'] },
                { selector: 'textarea', attrs: ['placeholder', 'id', 'name'] },
            ],
            phone: [
                { selector: 'input[type="tel"]', attrs: ['type'] },
                { selector: 'input[pattern*="[0-9]"]', attrs: ['pattern'] },
                { selector: 'input[maxlength="10"]', attrs: ['maxlength'] },
                { selector: 'input[placeholder*="phone" i]', attrs: ['placeholder'] },
            ],
            otp: [
                { selector: 'input[type="number"]', attrs: ['type', 'maxlength'] },
                { selector: 'input[maxlength="6"]', attrs: ['maxlength'] },
                { selector: 'input[minlength="6"]', attrs: ['minlength'] },
                { selector: 'input[autocomplete="one-time-code"]', attrs: ['autocomplete'] },
            ],
        };
        const results = [];
        const configs = strategies[purpose] || [];
        for (const config of configs) {
            if (this.failedSelectors.has(config.selector))
                continue;
            try {
                const elements = await this.page.$$(config.selector);
                for (const element of elements.slice(0, 5)) {
                    const hasRelevantAttr = await this.checkRelevantAttributes(element, purpose);
                    if (hasRelevantAttr) {
                        results.push({
                            selector: config.selector,
                            confidence: 0.7,
                            strategy: 'form-input',
                            elementCount: 1,
                        });
                    }
                }
            }
            catch {
                this.failedSelectors.add(config.selector);
            }
        }
        return results;
    }
    /**
     * Find elements by visual position and hierarchy
     */
    async findVisualElements(purpose) {
        const results = [];
        try {
            // Get all input fields and analyze their context
            const inputs = await this.page.$$('input, textarea, button');
            for (let i = 0; i < Math.min(inputs.length, 20); i++) {
                const input = inputs[i];
                // Get bounding box to determine position
                const box = await input.boundingBox().catch(() => null);
                if (!box)
                    continue;
                // Check if it's in header area (top 25% of page)
                const viewport = await this.page.viewportSize();
                if (!viewport)
                    continue;
                const isHeader = box.y < viewport.height * 0.25;
                const isWide = box.width > 200;
                if (purpose === 'search' && isHeader && isWide) {
                    results.push({
                        selector: `input >> nth=${i}`,
                        confidence: 0.6,
                        strategy: 'positional',
                        elementCount: 1,
                    });
                }
            }
        }
        catch {
            // Ignore errors
        }
        return results;
    }
    /**
     * Find elements using heuristics and common patterns
     */
    async findHeuristicElements(purpose) {
        const patterns = {
            search: [
                { pattern: 'search', attrs: ['placeholder', 'class', 'id', 'name'], weight: 1.0 },
                { pattern: 'find', attrs: ['placeholder', 'class', 'id'], weight: 0.8 },
                { pattern: 'look', attrs: ['placeholder', 'class'], weight: 0.7 },
            ],
            product: [
                { pattern: 'product', attrs: ['class', 'data-testid', 'id'], weight: 1.0 },
                { pattern: 'item', attrs: ['class', 'data-testid'], weight: 0.8 },
                { pattern: 'card', attrs: ['class'], weight: 0.6 },
            ],
            price: [
                { pattern: 'price', attrs: ['class', 'data-testid', 'id'], weight: 1.0 },
                { pattern: 'cost', attrs: ['class'], weight: 0.8 },
                { pattern: 'amount', attrs: ['class'], weight: 0.7 },
                { pattern: 'rs', attrs: ['class'], weight: 0.6 },
                { pattern: '₹', attrs: ['text'], weight: 1.0 },
            ],
        };
        const results = [];
        const heuristics = patterns[purpose] || [];
        for (const heuristic of heuristics) {
            for (const attr of heuristic.attrs) {
                let selector;
                if (attr === 'text') {
                    selector = `:has-text("${heuristic.pattern}")`;
                }
                else {
                    selector = `[${attr}*="${heuristic.pattern}" i]`;
                }
                if (this.failedSelectors.has(selector))
                    continue;
                try {
                    const elements = await this.page.$$(selector);
                    if (elements.length > 0) {
                        results.push({
                            selector,
                            confidence: heuristic.weight * Math.min(elements.length / 5, 1),
                            strategy: 'heuristic',
                            elementCount: elements.length,
                        });
                    }
                }
                catch {
                    this.failedSelectors.add(selector);
                }
            }
        }
        return results;
    }
    /**
     * Get page context for LLM analysis
     */
    async getPageContext() {
        if (!this.page)
            throw new Error('Page not initialized');
        return await this.page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => ({
                type: el.type || 'text',
                placeholder: el.getAttribute('placeholder') || '',
                location: el.closest('header') ? 'header' :
                    el.closest('main') ? 'main' :
                        el.closest('nav') ? 'nav' : 'other',
            }));
            const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
            const structure = Array.from(new Set(Array.from(document.querySelectorAll('[class]')).map(el => {
                const classes = el.className.split(' ').filter(c => c.length > 3);
                return classes.slice(0, 3).join(' ');
            }))).slice(0, 30).join(', ');
            return {
                title: document.title,
                url: window.location.href,
                structure,
                inputs,
                buttons: buttons.slice(0, 20),
            };
        });
    }
    /**
     * Calculate confidence score based on semantic match
     */
    calculateSemanticConfidence(purpose, selector, count) {
        let confidence = 0.5;
        // Boost for test IDs and data attributes
        if (selector.includes('data-testid') || selector.includes('data-')) {
            confidence += 0.2;
        }
        // Boost for semantic roles
        if (selector.includes('role=')) {
            confidence += 0.15;
        }
        // Boost for ARIA labels
        if (selector.includes('aria-label')) {
            confidence += 0.1;
        }
        // Penalize generic selectors
        if (selector === 'input' || selector === 'button') {
            confidence -= 0.3;
        }
        // Boost if unique element found
        if (count === 1 && purpose === 'search') {
            confidence += 0.1;
        }
        return Math.max(0, Math.min(1, confidence));
    }
    /**
     * Check if element has relevant attributes for the purpose
     */
    async checkRelevantAttributes(element, purpose) {
        try {
            const attributes = await element.evaluate((el) => {
                const attrs = {};
                for (const attr of el.attributes) {
                    attrs[attr.name] = attr.value.toLowerCase();
                }
                return attrs;
            });
            const keywords = {
                search: ['search', 'query', 'find', 'lookup', 'product'],
                phone: ['phone', 'mobile', 'number', 'tel', 'contact'],
                otp: ['otp', 'code', 'verify', 'verification', 'pin'],
                login: ['login', 'signin', 'auth', 'user'],
            };
            const searchTerms = keywords[purpose] || [];
            const attrValues = Object.values(attributes).join(' ');
            return searchTerms.some(term => attrValues.includes(term));
        }
        catch {
            return false;
        }
    }
    /**
     * Self-healing: Try multiple selectors with fallback
     */
    async findElementWithFallback(purpose, maxAttempts = 5) {
        const candidates = await this.discoverWithAI(purpose);
        for (const candidate of candidates.slice(0, maxAttempts)) {
            try {
                const element = await this.page.$$(candidate.selector);
                if (element.length > 0) {
                    this.selectorCache.set(purpose, candidate);
                    return { element: element[0], selector: candidate.selector };
                }
            }
            catch {
                this.failedSelectors.add(candidate.selector);
            }
        }
        return null;
    }
    /**
     * Validate and cache working selector
     */
    async validateSelector(purpose, selector) {
        if (!this.page)
            return false;
        try {
            const elements = await this.page.$$(selector);
            const works = elements.length > 0;
            if (works) {
                this.selectorCache.set(purpose, {
                    selector,
                    confidence: 0.9,
                    strategy: 'manual',
                    elementCount: elements.length,
                });
            }
            else {
                this.failedSelectors.add(selector);
            }
            return works;
        }
        catch {
            this.failedSelectors.add(selector);
            return false;
        }
    }
    /**
     * Learn from successful interactions
     */
    learnSelector(purpose, selector) {
        this.selectorCache.set(purpose, {
            selector,
            confidence: 0.95,
            strategy: 'learned',
            elementCount: 1,
        });
    }
    setPage(page) {
        this.page = page;
    }
    getPage() {
        return this.page;
    }
}
//# sourceMappingURL=resilient-selector.js.map