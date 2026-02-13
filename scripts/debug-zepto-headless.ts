/**
 * Debug script to test Zepto search functionality (headless with trace)
 * Run with: npx tsx scripts/debug-zepto-headless.ts
 * 
 * Outputs:
 * - trace.zip: Playwright trace (open with npx playwright show-trace trace.zip)
 * - screenshots/: Page screenshots at key points
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

async function debugZeptoHeadless() {
  console.log('🚀 Launching headless browser with trace recording...\n');
  
  // Ensure screenshots directory exists
  if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots', { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Start tracing
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();

  // Log all console messages
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      console.log('❌ Console error:', text);
    } else if (text.includes('zepto') || text.includes('api') || text.includes('search')) {
      console.log('📝 Console:', text);
    }
  });

  // Log network requests
  const apiRequests: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('api') || url.includes('search') || url.includes('product')) {
      apiRequests.push(`REQ: ${request.method()} ${url}`);
    }
  });

  page.on('response', response => {
    const url = response.url();
    if (url.includes('api') || url.includes('search') || url.includes('product')) {
      apiRequests.push(`RES: ${response.status()} ${url}`);
    }
  });

  try {
    console.log('📍 Step 1: Navigating to Zepto...');
    await page.goto('https://www.zeptonow.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait for page to stabilize
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Take screenshot of landing page
    await page.screenshot({ path: 'screenshots/01-landing.png', fullPage: true });
    console.log('📸 Screenshot: 01-landing.png');

    // Check for location/address popup
    console.log('\n📍 Step 2: Checking for location popup...');
    const locationSelectors = [
      'input[placeholder*="location"]',
      'input[placeholder*="address"]',
      'input[placeholder*="area"]',
      'input[placeholder*="pincode"]',
      '[class*="location-input"]',
      '[class*="LocationInput"]',
    ];

    for (const selector of locationSelectors) {
      const locationInput = await page.$(selector);
      if (locationInput) {
        console.log(`⚠️ Found location input: ${selector}`);
        const isVisible = await locationInput.isVisible();
        if (isVisible) {
          console.log('📍 Location popup is visible. Taking screenshot...');
          await page.screenshot({ path: 'screenshots/02-location-popup.png', fullPage: true });
          console.log('📸 Screenshot: 02-location-popup.png');
        }
      }
    }

    // Check for cookies/consent modal
    const consentButton = await page.$('button:has-text("Accept"), button:has-text("Allow"), button:has-text("Got it")');
    if (consentButton) {
      console.log('🍪 Found consent button, clicking...');
      await consentButton.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Check login status
    console.log('\n📍 Step 3: Checking login status...');
    const loginButton = await page.$('button:has-text("Login"), button:has-text("Sign in"), a:has-text("Login")');
    if (loginButton) {
      const isVisible = await loginButton.isVisible().catch(() => false);
      console.log(isVisible ? '⚠️ Not logged in - login button visible' : '✅ Login button not visible');
    } else {
      console.log('✅ Already logged in (no login button found)');
    }

    // Find search input
    console.log('\n📍 Step 4: Looking for search input...');
    const searchSelectors = [
      '[data-testid="search-input"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'input[type="search"]',
      '[class*="SearchInput"]',
      '[class*="search-input"]',
      'input[autocomplete="off"]',
    ];

    let searchInput = null;
    let foundSelector = '';
    for (const selector of searchSelectors) {
      try {
        searchInput = await page.$(selector);
        if (searchInput) {
          const isVisible = await searchInput.isVisible().catch(() => false);
          if (isVisible) {
            foundSelector = selector;
            console.log(`✅ Found search input: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Ignore selector errors
      }
    }

    if (!searchInput) {
      console.log('❌ No search input found with known selectors');
      
      // Find all visible inputs
      const allInputs = await page.$$('input');
      console.log(`\n📋 Found ${allInputs.length} input elements:`);
      
      for (let i = 0; i < allInputs.length; i++) {
        try {
          const input = allInputs[i];
          const isVisible = await input.isVisible().catch(() => false);
          if (!isVisible) continue;
          
          const placeholder = await input.getAttribute('placeholder');
          const type = await input.getAttribute('type');
          const id = await input.getAttribute('id');
          const name = await input.getAttribute('name');
          const className = await input.getAttribute('class');
          console.log(`  ${i + 1}. type="${type}" placeholder="${placeholder}" name="${name}" id="${id}"`);
          console.log(`     class="${className?.substring(0, 80)}..."`);
        } catch (e) {
          // Skip
        }
      }

      await page.screenshot({ path: 'screenshots/03-no-search-found.png', fullPage: true });
      console.log('📸 Screenshot: 03-no-search-found.png');
    } else {
      // Click on search
      console.log('\n📍 Step 5: Clicking search input...');
      await searchInput.click();
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'screenshots/04-search-clicked.png' });
      console.log('📸 Screenshot: 04-search-clicked.png');

      // Type search query
      console.log('📍 Step 6: Typing "milk"...');
      await searchInput.fill('milk');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'screenshots/05-search-typed.png' });
      console.log('📸 Screenshot: 05-search-typed.png');

      // Try pressing Enter
      await page.keyboard.press('Enter');
      console.log('📍 Step 7: Pressed Enter, waiting for results...');
      await page.waitForTimeout(5000);

      await page.screenshot({ path: 'screenshots/06-after-enter.png', fullPage: true });
      console.log('📸 Screenshot: 06-after-enter.png');

      // Look for product cards
      console.log('\n📍 Step 8: Looking for products...');
      const productSelectors = [
        '[data-testid="product-card"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[class*="item"]',
        'a[href*="/product/"]',
        '[class*="sku"]',
      ];

      for (const selector of productSelectors) {
        const products = await page.$$(selector);
        if (products.length > 0) {
          console.log(`✅ Found ${products.length} elements with: ${selector}`);
          
          for (let i = 0; i < Math.min(5, products.length); i++) {
            try {
              const product = products[i];
              const text = await product.textContent();
              const title = text?.split('\n').slice(0, 3).join(' | ').substring(0, 100);
              console.log(`  Product ${i + 1}: ${title}...`);
            } catch (e) {
              // Skip
            }
          }
          break;
        }
      }
    }

    // Save page HTML for inspection
    const html = await page.content();
    fs.writeFileSync('screenshots/page.html', html);
    console.log('\n📄 Saved page HTML: screenshots/page.html');

    // Print API requests found
    if (apiRequests.length > 0) {
      console.log('\n🌐 API Requests captured:');
      apiRequests.slice(0, 20).forEach(req => console.log(`  ${req}`));
    }

    console.log('\n✅ Debug complete! Check screenshots/ directory.');

  } catch (error) {
    console.error('❌ Error:', error);
    await page.screenshot({ path: 'screenshots/error.png', fullPage: true }).catch(() => {});
  } finally {
    // Stop tracing and save
    await context.tracing.stop({ path: 'trace.zip' });
    console.log('\n📦 Trace saved: trace.zip (view with: npx playwright show-trace trace.zip)');
    
    await browser.close();
  }
}

debugZeptoHeadless().catch(console.error);