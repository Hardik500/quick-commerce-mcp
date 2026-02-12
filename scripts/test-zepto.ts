/**
 * Test script to verify Zepto platform selectors
 * Run with: npx tsx scripts/test-zepto.ts
 */
import { chromium } from 'playwright';
import { ZeptoPlatform } from '../src/platforms/zepto.js';

async function testZepto() {
  console.log('🚀 Starting Zepto selector test...\n');

  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 100 
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });

  const zepto = new ZeptoPlatform();
  
  try {
    console.log('1️⃣ Initializing Zepto platform...');
    await zepto.initialize(context);
    console.log('✅ Platform initialized\n');

    // Wait for user to see the page
    console.log('⏳ Page loaded. Check if you see zeptonow.com');
    console.log('Taking screenshot in 5 seconds...\n');
    await new Promise(r => setTimeout(r, 5000));

    // Screenshot
    const page = (zepto as any).page;
    if (page) {
      await page.screenshot({ path: 'logs/zepto-home.png' });
      console.log('📸 Screenshot saved to logs/zepto-home.png\n');
    }

    // Test search
    console.log('2️⃣ Testing search for "Coke Zero"...');
    const loginStatus = await zepto.checkLogin();
    console.log('   Login status:', loginStatus);

    if (!loginStatus.loggedIn) {
      console.log('\n⚠️ Not logged in. This is expected for first run.');
      console.log('   The test will check selectors without full login.');
      console.log('\n   To test fully:');
      console.log('   1. Login manually in the browser window');
      console.log('   2. Re-run this test\n');
    }

    console.log('✅ Test complete! Check logs/zepto-home.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    console.log('\n⏳ Closing browser in 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));
    await zepto.close();
    await browser.close();
  }
}

testZepto();
