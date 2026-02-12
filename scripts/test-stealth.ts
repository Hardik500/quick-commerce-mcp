/**
 * Hybrid test: Stealth mode + API fallback
 * Option 1 (Stealth) > Option 2 (API) > Manual failover
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';

async function testWithStealth() {
  console.log('🥷 Testing with STEALTH MODE\n');

  const stealth = new StealthBrowser();
  
  try {
    const context = await stealth.launch({
      headless: true,
      slowMo: 100,
    });

    console.log('✅ Stealth browser launched\n');

    const page = await context.newPage();

    // Test Zepto
    console.log('📱 Testing Zepto with stealth...');
    await page.goto('https://www.zeptonow.com', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const title = await page.title();
    const url = page.url();
    console.log(`   Title: ${title}`);
    console.log(`   URL: ${url}\n`);

    // Screenshot
    await page.screenshot({ path: 'logs/zepto-stealth.png' });
    console.log('📸 Screenshot: logs/zepto-stealth.png\n');

    // Try to find search with enhanced selectors
    console.log('🔍 Searching for search input...');
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      'input[placeholder*="search" i]',
      '[role="search"] input',
      'input:not([type])',
      'input[type="text"]',
      '[class*="search"] input',
      '[data-testid*="search"] input',
    ];

    let foundSearch = false;
    for (const selector of searchSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          const placeholder = await input.getAttribute('placeholder');
          const type = await input.getAttribute('type');
          console.log(`   ✅ Found: ${selector}`);
          console.log(`      Type: ${type}, Placeholder: "${placeholder}"`);
          foundSearch = true;

          // Try to use it
          await input.click();
          await input.fill('coke zero');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);

          // Check for products
          const products = await page.$$('[class*="product"], [class*="item"], article');
          console.log(`   📦 Found ${products.length} product containers\n`);
          break;
        }
      } catch (e) {
        // Continue
      }
    }

    if (!foundSearch) {
      console.log('   ❌ Could not find search input with stealth\n');
      console.log('   🔄 Will try API-based approach...\n');
    }

    // Test if we got through to the real app
    const pageContent = await page.content();
    const isRealApp = pageContent.includes('product') || pageContent.includes('cart') || pageContent.includes('search');
    console.log(`   Real app page: ${isRealApp ? '✅ Yes' : '❌ No (likely landing/blocked)'}`);

    // Check for challenge/verification pages
    if (pageContent.includes('cf-challenge') || pageContent.includes('captcha') || url.includes('challenge')) {
      console.log('   ⚠️ Cloudflare challenge detected - switching to API approach needed');
    }

    await stealth.close();
    console.log('\n🏁 Stealth test complete');
    return { success: foundSearch, isRealApp };

  } catch (error: any) {
    console.error('❌ Stealth failed:', error.message);
    await stealth.close();
    return { success: false, isRealApp: false };
  }
}

// Run test
testWithStealth().then(result => {
  console.log('\n' + '='.repeat(50));
  console.log('RESULT: STEALTH MODE');
  console.log('='.repeat(50));
  console.log(`Search found: ${result.success ? '✅' : '❌'}`);
  console.log(`Real app loaded: ${result.isRealApp ? '✅' : '❌'}`);
  
  if (!result.success) {
    console.log('\n📋 Recommendation: Proceed to Option 2 (API-based approach)');
    console.log('   Sites have strong anti-bot protection');
  }
});
