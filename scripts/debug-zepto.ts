/**
 * Debug script to test Zepto search functionality
 * Run with: npx tsx scripts/debug-zepto.ts
 */
import { chromium } from 'playwright';

async function debugZepto() {
  console.log('🚀 Launching browser in headed mode for debugging...\n');
  
  const browser = await chromium.launch({
    headless: false, // Show browser UI
    slowMo: 500, // Slow down actions for visibility
    devtools: true, // Open DevTools
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Log all console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Console error:', msg.text());
    } else {
      console.log('📝 Console:', msg.text());
    }
  });

  // Log all network requests
  page.on('request', request => {
    if (request.url().includes('zepto') || request.url().includes('api')) {
      console.log('🌐 Request:', request.method(), request.url());
    }
  });

  page.on('response', response => {
    if (response.url().includes('zepto') && response.url().includes('api')) {
      console.log('📥 Response:', response.status(), response.url());
    }
  });

  try {
    console.log('📍 Step 1: Navigating to Zepto...');
    await page.goto('https://www.zeptonow.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Check for location popup
    console.log('\n📍 Step 2: Checking for location popup...');
    const locationInput = await page.$('input[placeholder*="location"], input[placeholder*="address"], input[placeholder*="area"]');
    if (locationInput) {
      console.log('⚠️ Location popup detected. Please enter location manually in the browser.');
      await page.waitForTimeout(10000); // Wait for manual input
    }

    // Check for login button
    console.log('\n📍 Step 3: Checking login status...');
    const loginButton = await page.$('button:has-text("Login"), button:has-text("Sign in")');
    if (loginButton) {
      console.log('⚠️ Not logged in. Login button found.');
    } else {
      console.log('✅ Already logged in (no login button visible)');
    }

    // Try to find search input
    console.log('\n📍 Step 4: Looking for search input...');
    const searchSelectors = [
      '[data-testid="search-input"]',
      'input[placeholder*="search"]',
      'input[placeholder*="Search"]',
      'input[type="search"]',
      '[class*="search"]',
    ];

    let searchInput = null;
    for (const selector of searchSelectors) {
      searchInput = await page.$(selector);
      if (searchInput) {
        console.log(`✅ Found search input with selector: ${selector}`);
        break;
      }
    }

    if (!searchInput) {
      console.log('❌ No search input found. Taking screenshot...');
      await page.screenshot({ path: 'screenshots/no-search-input.png', fullPage: true });
      console.log('📸 Screenshot saved: screenshots/no-search-input.png');
      
      // Try to find any input
      const allInputs = await page.$$('input');
      console.log(`\n📋 Found ${allInputs.length} input elements on page:`);
      for (let i = 0; i < allInputs.length; i++) {
        const input = allInputs[i];
        const placeholder = await input.getAttribute('placeholder');
        const type = await input.getAttribute('type');
        const id = await input.getAttribute('id');
        const className = await input.getAttribute('class');
        console.log(`  ${i + 1}. type="${type}" placeholder="${placeholder}" id="${id}" class="${className?.substring(0, 50)}..."`);
      }
    } else {
      // Click on search and type
      console.log('\n📍 Step 5: Clicking search input...');
      await searchInput.click();
      await page.waitForTimeout(1000);

      console.log('📍 Step 6: Typing "milk"...');
      await searchInput.fill('milk');
      await page.waitForTimeout(2000);

      // Press Enter or click search button
      await page.keyboard.press('Enter');
      console.log('📍 Step 7: Waiting for results...');
      await page.waitForTimeout(3000);

      // Take screenshot of results
      await page.screenshot({ path: 'screenshots/search-results.png', fullPage: true });
      console.log('📸 Screenshot saved: screenshots/search-results.png');

      // Try to find product cards
      console.log('\n📍 Step 8: Looking for product cards...');
      const productSelectors = [
        '[data-testid="product-card"]',
        '[class*="product"]',
        '[class*="ProductCard"]',
        '[class*="item-card"]',
      ];

      for (const selector of productSelectors) {
        const products = await page.$$(selector);
        if (products.length > 0) {
          console.log(`✅ Found ${products.length} products with selector: ${selector}`);
          
          // Get details of first few products
          for (let i = 0; i < Math.min(3, products.length); i++) {
            const product = products[i];
            const text = await product.textContent();
            console.log(`\n  Product ${i + 1}: ${text?.substring(0, 100)}...`);
          }
          break;
        }
      }
    }

    console.log('\n✅ Debug complete! Check the browser window and screenshots.');
    console.log('⏳ Keeping browser open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Error:', error);
    await page.screenshot({ path: 'screenshots/error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugZepto().catch(console.error);