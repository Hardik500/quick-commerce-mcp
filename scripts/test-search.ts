/**
 * Direct test of quick commerce platforms
 * Run: npx tsx scripts/test-search.ts
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath } from '../src/session-helper.js';
import { ZeptoPlatform } from '../src/platforms/zepto.js';
import { BlinkitPlatform } from '../src/platforms/blinkit.js';

async function testSearch() {
  console.log('🚀 Starting live search test for "6 pack Coke Zero"\n');

  // Each platform gets its own browser context (and storageState), matching
  // how index.ts isolates sessions per platform - sharing one context would
  // only ever restore the first platform's session file.
  const zeptoBrowser = new StealthBrowser();
  const blinkitBrowser = new StealthBrowser();

  try {
    // Test Zepto
    console.log('📱 Testing ZEPTO...');
    const zeptoContext = await zeptoBrowser.launch({
      headless: true, // Set false to see browser
      slowMo: 50,
      storageStatePath: sessionPath('zepto'),
    });
    const zepto = new ZeptoPlatform();
    await zepto.initialize(zeptoContext);

    // Check login
    const zeptoLogin = await zepto.checkLogin();
    console.log('   Login status:', zeptoLogin.loggedIn ? '✅ Logged in' : '❌ Not logged in');

    if (!zeptoLogin.loggedIn) {
      console.log('   ⚠️  Zepto requires login. Skipping search.');
      console.log('   (You would see an OTP prompt here in the real MCP)\n');
    } else {
      const zeptoResults = await zepto.search('Coke Zero 6 pack');
      console.log(`   Found ${zeptoResults.products.length} products:\n`);
      zeptoResults.products.slice(0, 3).forEach((p, i) => {
        console.log(`   ${i+1}. ${p.name}`);
        console.log(`      Price: ₹${p.price}${p.mrp ? ` (MRP: ₹${p.mrp})` : ''}`);
        console.log(`      ID: ${p.id}\n`);
      });
    }

    // Test Blinkit
    console.log('📱 Testing BLINKIT...');
    const blinkitContext = await blinkitBrowser.launch({
      headless: true,
      slowMo: 50,
      storageStatePath: sessionPath('blinkit'),
    });
    const blinkit = new BlinkitPlatform();
    await blinkit.initialize(blinkitContext);

    const blinkitLogin = await blinkit.checkLogin();
    console.log('   Login status:', blinkitLogin.loggedIn ? '✅ Logged in' : '❌ Not logged in');

    if (!blinkitLogin.loggedIn) {
      console.log('   ⚠️  Blinkit requires login. Skipping search.');
      console.log('   (You would see an OTP prompt here in the real MCP)\n');
    } else {
      const blinkitResults = await blinkit.search('Coke Zero 6 pack');
      console.log(`   Found ${blinkitResults.products.length} products:\n`);
      blinkitResults.products.slice(0, 3).forEach((p, i) => {
        console.log(`   ${i+1}. ${p.name}`);
        console.log(`      Price: ₹${p.price}${p.mrp ? ` (MRP: ₹${p.mrp})` : ''}${p.discount ? ` ${p.discount}` : ''}`);
        console.log(`      ID: ${p.id}\n`);
      });
    }

    console.log('✅ Test complete!\n');
    console.log('💡 In the real MCP flow:');
    console.log('   - You would be prompted for OTP if not logged in');
    console.log('   - After login, search results would be displayed');
    console.log('   - Choose products to add to cart');
    console.log('   - Confirm before placing order');

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await zeptoBrowser.close();
    await blinkitBrowser.close();
    console.log('\n🏁 Browsers closed.');
  }
}

testSearch();
