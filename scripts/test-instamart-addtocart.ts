/**
 * Verifies SwiggyInstamartPlatform search/addToCart/getCart/clearCart against
 * the live, authenticated site. Restores the original cart; never checks out.
 * Run: npx tsx scripts/test-instamart-addtocart.ts
 */
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath } from '../src/session-helper.js';
import { SwiggyInstamartPlatform } from '../src/platforms/swiggy-instamart.js';
import assert from 'node:assert/strict';
import { stripPackSize } from '../src/ranking.js';

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
    assert.ok(login.loggedIn, 'Log in to Instamart before running the live regression');
    const baseline = await instamart.getCart();
    assert.ok(baseline, 'Could not read the original cart');
    const norm = (name: string) => stripPackSize(name).toLowerCase().replace(/\s+/g, ' ').trim();
    const results = await instamart.search(process.env.QC_INSTAMART_TEST_QUERY || 'amul milk');
    const target = results.products.find(p => p.inStock && !baseline.items.some(i => norm(i.name) === norm(p.name)));
    assert.ok(target, 'Need an in-stock test item absent from the original cart');
    try {
      // An ID-only request must work after cart navigation.
      await instamart.getCart();
      const outcome = await instamart.addToCart(target.id, 2);
      assert.equal(outcome, 'added', instamart.lastAddBlocker || `Unexpected add outcome: ${outcome}`);
      const cart = await instamart.getCart();
      assert.equal(cart?.items.find(i => norm(i.name) === norm(target.name))?.cartQuantity, 2);
      assert.equal(await instamart.addToCart(target.id, 2), 'already');
      console.log('Search, ID-only add, exact quantity, repeat add: passed');
    } finally {
      const cart = await instamart.getCart();
      const added = cart?.items.find(i => norm(i.name) === norm(target.name));
      if (added) assert.equal(await instamart.removeFromCart(added.name), true, 'Could not remove the test item');
      const restored = await instamart.getCart();
      const snapshot = (items: typeof baseline.items) => items.map(i => `${i.name}|${i.quantity}|${i.cartQuantity}`).sort();
      assert.ok(restored, 'Could not verify cleanup');
      assert.deepEqual(snapshot(restored.items), snapshot(baseline.items), 'The original cart was not restored');
      console.log('Original cart restored');
    }
  } finally {
    await stealth.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
