/**
 * Verifies BlinkitPlatform.addToCart() against the live, authenticated site.
 * Run: npx tsx scripts/test-blinkit-addtocart.ts
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath } from '../src/session-helper.js';
import { BlinkitPlatform } from '../src/platforms/blinkit.js';

async function main() {
  const stealth = new StealthBrowser();
  const context = await stealth.launch({
    headless: true,
    storageStatePath: sessionPath('blinkit'),
  });

  try {
    const blinkit = new BlinkitPlatform();
    await blinkit.initialize(context);

    const login = await blinkit.checkLogin();
    console.log('Login status:', login.loggedIn ? '✅ Logged in' : '❌ Not logged in');
    if (!login.loggedIn) return;

    const results = await blinkit.search('milk');
    console.log(`Found ${results.products.length} products`);
    if (results.products.length === 0) return;

    const target = results.products[0];
    console.log(`Adding to cart: ${target.name} (ID: ${target.id})`);

    const added = await blinkit.addToCart(target.id, 1);
    console.log('addToCart result:', added ? '✅ success' : '❌ failed');
  } finally {
    await stealth.close();
  }
}

main().catch(console.error);
