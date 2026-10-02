/**
 * Stealth browser configuration for evading anti-bot detection
 * Combines playwright-stealth with custom evasion techniques
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import { stealthScript } from './stealth-script.js';
/**
 * Optional position override from QC_GEOLOCATION="<lat>,<lon>".
 *
 * The permission grant below is what actually unblocks Blinkit's "Select your
 * location" modal. Blinkit always knows a coarse position anyway - it geolocates
 * the request IP server-side and sets gr_1_lat/gr_1_lon, so the modal can be
 * cleared without this. What the browser cannot do is produce a *precise*
 * position: navigator.geolocation times out (code 3) in Playwright's Chromium,
 * which has no OS location provider. So this override only exists to replace a
 * bad IP guess (VPN/Tailscale exit node, wrong city) with a known-good point.
 * Once logged in, list_addresses + select_address is the authoritative fix.
 */
function geolocationFix() {
    const raw = process.env.QC_GEOLOCATION?.trim();
    if (!raw)
        return undefined;
    const [lat, lon] = raw.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        console.error(`Ignoring QC_GEOLOCATION="${raw}": expected "<lat>,<lon>" within range.`);
        return undefined;
    }
    return { latitude: lat, longitude: lon };
}
/** Overrides the "chrome" channel; only used to point tests at a local build. */
export const CHROME_PATH_ENV = 'QC_CHROME_PATH';
export class StealthBrowser {
    browser = null;
    context = null;
    async launch(config = {}) {
        const { headless = true, slowMo = 50, proxy, userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1', viewport = { width: 390, height: 844 }, storageStatePath, } = config;
        // Launch with anti-detection args. Uses the system-installed Google
        // Chrome (channel: 'chrome') instead of Playwright's bundled Chromium,
        // since downloading/extracting the bundled browser is impractically
        // slow on machines with endpoint security scanning every written file.
        // QC_CHROME_PATH takes precedence over the "chrome" channel, for pointing at
        // a Chrome/Chromium build Playwright's channel lookup can't find.
        const chromePath = process.env[CHROME_PATH_ENV]?.trim();
        this.browser = await chromium.launch({
            ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
            headless,
            slowMo,
            proxy: proxy ? { server: proxy } : undefined,
            // Playwright installs its own SIGINT/SIGTERM handlers that close the
            // browser immediately on signal receipt, racing our own handlers that
            // need the browser alive to call storageState() first. Disabling lets
            // callers (e.g. session-helper.ts) own shutdown ordering.
            handleSIGINT: false,
            handleSIGTERM: false,
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
            colorScheme: 'light',
            reducedMotion: 'no-preference',
            forcedColors: 'none',
            // Blinkit's "Select your location" modal only closes when this permission
            // is granted; it has no close button and ignores Escape and backdrop
            // clicks. Without it the modal covers the page at z-index 10001, the
            // profile button can never be clicked (30s Playwright timeout), and login
            // is unreachable. Zepto's location prompt is the same shape.
            permissions: ['geolocation'],
            geolocation: geolocationFix(),
            storageState: storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined,
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