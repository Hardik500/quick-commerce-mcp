/**
 * Debug script with stealth mode to bypass CloudFront/bot detection
 * Run with: npx tsx scripts/debug-zepto-stealth.ts
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

async function debugZeptoStealth() {
  console.log('🚀 Launching stealth browser...\n');
  
  if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots', { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // Remove webdriver flag
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-IN,en;q=0.9,en-GB;q=0.8,en-US;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Start tracing
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();

  // Apply stealth patches
  await page.addInitScript(() => {
    // Hide webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    // Mock languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en', 'en-GB', 'en-US'],
    });

    // Mock platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
    });

    // Mock hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // Mock device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );

    // Hide automation
    // @ts-ignore
    window.chrome = { runtime: {} };

    // Mock iframe contentWindow
    const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function() {
        const iframe = originalContentWindow?.get.call(this);
        if (iframe) {
          Object.defineProperty(iframe.navigator, 'webdriver', { get: () => undefined });
        }
        return iframe;
      },
    });
  });

  // Log console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Console:', msg.text());
    }
  });

  // Log network requests
  const apiRequests: string[] = [];
  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    if (status >= 400) {
      apiRequests.push(`❌ ${status}: ${url}`);
    } else if (url.includes('api') || url.includes('search') || url.includes('product')) {
      apiRequests.push(`✅ ${status}: ${url}`);
    }
  });

  try {
    console.log('📍 Step 1: Navigating to Zepto...');
    
    // Use a real referrer
    await page.goto('https://www.zeptonow.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait a bit for dynamic content
    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({ path: 'screenshots/stealth-01-landing.png', fullPage: true });
    console.log('📸 Screenshot: stealth-01-landing.png');

    // Check page title to verify we got through
    const title = await page.title();
    console.log(`📄 Page title: ${title}`);

    // Check for errors
    const bodyText = await page.locator('body').textContent();
    if (bodyText?.includes('403 ERROR') || bodyText?.includes('Request blocked')) {
      console.log('❌ Still blocked by CloudFront/Cloudflare');
      
      // Try alternate approach - mobile site
      console.log('\n🔄 Trying mobile site...');
      await page.goto('https://www.zeptonow.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(5000);

      await page.screenshot({ path: 'screenshots/stealth-02-mobile.png', fullPage: true });
      console.log('📸 Screenshot: stealth-02-mobile.png');
    }

    // Check for inputs
    const allInputs = await page.$$('input');
    console.log(`\n📋 Found ${allInputs.length} input elements`);

    for (let i = 0; i < allInputs.length; i++) {
      try {
        const input = allInputs[i];
        const isVisible = await input.isVisible().catch(() => false);
        if (!isVisible) continue;

        const placeholder = await input.getAttribute('placeholder') || '';
        const type = await input.getAttribute('type') || '';
        const name = await input.getAttribute('name') || '';
        const id = await input.getAttribute('id') || '';
        const className = await input.getAttribute('class') || '';
        
        console.log(`  ${i + 1}. [${type}] placeholder="${placeholder}" name="${name}" id="${id}"`);
        if (className) console.log(`     class="${className.substring(0, 60)}..."`);
      } catch (e) {}
    }

    // Save HTML
    const html = await page.content();
    fs.writeFileSync('screenshots/stealth-page.html', html);
    console.log('\n📄 Saved: screenshots/stealth-page.html');

    // Print API requests
    if (apiRequests.length > 0) {
      console.log('\n🌐 Network activity:');
      apiRequests.slice(0, 30).forEach(req => console.log(`  ${req}`));
    }

  } catch (error) {
    console.error('❌ Error:', error);
    await page.screenshot({ path: 'screenshots/stealth-error.png', fullPage: true }).catch(() => {});
  } finally {
    await context.tracing.stop({ path: 'trace-stealth.zip' });
    console.log('\n📦 Trace: trace-stealth.zip');
    await browser.close();
  }
}

debugZeptoStealth().catch(console.error);