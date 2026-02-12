/**
 * Stealth browser configuration for evading anti-bot detection
 * Combines playwright-stealth with custom evasion techniques
 */
import { chromium } from 'playwright';
import { stealthScript } from './stealth-script.js';
export class StealthBrowser {
    browser = null;
    context = null;
    async launch(config = {}) {
        const { headless = true, slowMo = 50, proxy, userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', viewport = { width: 390, height: 844 }, } = config;
        // Launch with anti-detection args
        this.browser = await chromium.launch({
            headless,
            slowMo,
            proxy: proxy ? { server: proxy } : undefined,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-web-security',
                '--disable-features=BlockInsecurePrivateNetworkRequests',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-features=TranslateUI',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-renderer-backgrounding',
                '--disable-sync',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
            ],
        });
        // Create context with stealth settings
        this.context = await this.browser.newContext({
            userAgent,
            viewport,
            deviceScaleFactor: 3, // iPhone Retina
            isMobile: true,
            hasTouch: true,
            locale: 'en-IN',
            timezoneId: 'Asia/Kolkata',
            geolocation: { latitude: 19.076, longitude: 72.8777 }, // Mumbai
            permissions: ['geolocation'],
            colorScheme: 'light',
            reducedMotion: 'no-preference',
            forcedColors: 'none',
        });
        // Apply stealth script to all pages
        this.context.on('page', async (page) => {
            await page.addInitScript(stealthScript);
        });
        // Also apply to existing pages
        const existingPages = this.context.pages();
        for (const page of existingPages) {
            await page.addInitScript(stealthScript);
        }
        return this.context;
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
        }
    }
    getContext() {
        return this.context;
    }
}
//# sourceMappingURL=stealth-browser.js.map