/**
 * Verifies SwiggyInstamartPlatform search/addToCart/getCart/clearCart against
 * the live, authenticated site. Leaves the cart empty.
 * Run: npx tsx scripts/test-instamart-addtocart.ts
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath } from '../src/session-helper.js';
import { SwiggyInstamartPlatform } from '../src/platforms/swiggy-instamart.js';

async function main() {
  const stealth = new StealthBrowser();
  const context = await stealth.launch({
    headless: true,
    storageStatePath: sessionPath('swiggy-instamart'),
  });

  try {
    const instamart = new SwiggyInstamartPlatform();
    await instamart.initialize(context);

    const login = await instamart.checkLogin();
    console.log('Login status:', login.loggedIn ? '✅ Logged in' : '❌ Not logged in');
    if (!login.loggedIn) return;

    const results = await instamart.search('amul milk');
    console.log(`Found ${results.products.length} products`);
    console.log(results.products.slice(0, 3));
    if (results.products.length < 2) return;

    // First result has variants (opens the variant sheet); second doesn't.
    for (const [target, qty] of [[results.products[0], 2], [results.products[1], 1]] as const) {
      const added = await instamart.addToCart(target.id, qty);
      console.log(`addToCart(${target.name}, ${qty}):`, added ? '✅' : '❌');
    }

    const cart = await instamart.getCart();
    console.log('Cart:', JSON.stringify(cart, null, 1));

    const cleared = await instamart.clearCart();
    console.log('clearCart:', cleared ? '✅' : '❌');
    console.log('Cart after clear:', (await instamart.getCart())?.items.length, 'items');
  } finally {
    await stealth.close();
  }
}

main().catch(console.error);
