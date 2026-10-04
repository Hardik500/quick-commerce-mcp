/**
 * Stealth browser configuration for evading anti-bot detection
 * Combines playwright-stealth with custom evasion techniques
 */
import { chromium, BrowserContext, Browser } from 'playwright';
import * as fs from 'fs';
import { stealthScript } from './stealth-script.js';

export interface StealthConfig {
  headless?: boolean;
  slowMo?: number;
  proxy?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  storageStatePath?: string;
  desktop?: boolean;
  /** Dedicated native desktop profile; never point at a user's main profile. */
  userDataDir?: string;
  /** Attach to a user-controlled local interactive Chrome browser. */
  cdpEndpoint?: string;
}

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
function geolocationFix(): { latitude: number; longitude: number } | undefined {
  const raw = process.env.QC_GEOLOCATION?.trim();
  if (!raw) return undefined;
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
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private attached = false;

  async launch(config: StealthConfig = {}): Promise<BrowserContext> {
    const {
      headless = true,
      slowMo = 50,
      proxy,
      userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport = { width: 390, height: 844 },
      storageStatePath,
    } = config;

    // Launch with anti-detection args. Uses the system-installed Google
    // Chrome (channel: 'chrome') instead of Playwright's bundled Chromium,
    // since downloading/extracting the bundled browser is impractically
    // slow on machines with endpoint security scanning every written file.
    // QC_CHROME_PATH takes precedence over the "chrome" channel, for pointing at
    // a Chrome/Chromium build Playwright's channel lookup can't find.
    const chromePath = process.env[CHROME_PATH_ENV]?.trim();
    if (config.cdpEndpoint) {
      const endpoint = new URL(config.cdpEndpoint);
      if (!config.desktop || endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
        throw new Error('Interactive browser attachment requires a loopback HTTP endpoint in desktop mode.');
      }
      this.browser = await chromium.connectOverCDP(config.cdpEndpoint);
      this.attached = true;
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error('Interactive browser did not expose a default context.');
      return this.context;
    }
    if (config.userDataDir) {
      if (!config.desktop) throw new Error('Persistent profiles require native desktop mode.');
      fs.mkdirSync(config.userDataDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(config.userDataDir, 0o700);
      this.context = await chromium.launchPersistentContext(config.userDataDir, {
        ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' as const }),
        headless, slowMo, viewport, deviceScaleFactor: 1, isMobile: false, hasTouch: false,
        locale: 'en-IN', timezoneId: 'Asia/Kolkata',
        proxy: proxy ? { server: proxy } : undefined,
        handleSIGINT: false, handleSIGTERM: false, args: ['--disable-dev-shm-usage'],
      });
      this.browser = this.context.browser();
      return this.context;
    }
    this.browser = await chromium.launch({
      ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' as const }),
      headless,
      slowMo,
      proxy: proxy ? { server: proxy } : undefined,
      // Playwright installs its own SIGINT/SIGTERM handlers that close the
      // browser immediately on signal receipt, racing our own handlers that
      // need the browser alive to call storageState() first. Disabling lets
      // callers (e.g. session-helper.ts) own shutdown ordering.
      handleSIGINT: false,
      handleSIGTERM: false,
      args: config.desktop ? ['--disable-dev-shm-usage'] : [
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
      // Keep native desktop APIs and UA for third-party login/payment frames.
      userAgent: config.desktop ? config.userAgent : userAgent,
      viewport,
      deviceScaleFactor: config.desktop ? 1 : 3,
      isMobile: !config.desktop,
      hasTouch: !config.desktop,
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

    if (config.desktop) return this.context;

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

  /** Erase authentication from a dedicated attached browser before disconnecting. */
  async clearAuthentication(): Promise<void> {
    if (!this.context) throw new Error('No browser context to clear.');
    const state = await this.context.storageState();
    const origins = new Set(state.origins.map(origin => origin.origin));
    for (const page of this.context.pages()) {
      try { const origin = new URL(page.url()).origin; if (origin !== 'null') origins.add(origin); } catch { /* blank page */ }
    }
    const page = this.context.pages()[0] ?? await this.context.newPage();
    const cdp = await this.context.newCDPSession(page);
    try {
      await this.context.clearCookies();
      for (const origin of origins) await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      for (const openPage of this.context.pages()) await openPage.goto('about:blank');
    } finally { await cdp.detach(); }
  }

  async close(): Promise<void> {
    if (this.attached) {
      // Disconnect MCP; the user's interactive browser and profile stay open.
      await this.browser?.close();
      this.browser = null; this.context = null; this.attached = false;
      return;
    }
    // Closing a persistent context flushes the profile to disk.
    if (this.context) await this.context.close();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  getContext(): BrowserContext | null {
    return this.context;
  }
}
