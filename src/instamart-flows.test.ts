import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { SwiggyInstamartPlatform } from './platforms/swiggy-instamart.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.QC_CHROME_PATH || undefined, headless: true });
});
after(async () => { await browser?.close(); });

// Deliberately use the adapter's real selectors and optimistic counters. The
// route's basket is authoritative across navigation, not localStorage alone.
async function storefront(options: {
  variants?: boolean; inStock?: boolean; retained?: boolean; delay?: number;
  failedWrite?: boolean; mismatch?: boolean; duplicate?: boolean; proofDelay?: number;
  unavailable?: boolean; payment?: boolean; writeDelay?: number; rejectZero?: boolean; addressError?: boolean;
} = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: '_session_tid', value: 'fixture-account', url: 'https://www.swiggy.com' }]);
  let persisted = 0;
  let unavailable = options.unavailable || false;
  const writes: number[] = [];
  await context.route('https://www.swiggy.com/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/instamart/api/cart') {
      const next = Number(route.request().postData());
      writes.push(next);
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      const failed = options.failedWrite || (options.rejectZero && next === 0) || options.addressError;
      if (!failed) persisted = next;
      await route.fulfill({ status: failed && !options.addressError ? 500 : 200,
        json: options.addressError ? { statusCode: 0, data: { statusCode: 137, statusMessage: 'User Addresses not found for user' } } : { quantity: persisted } }).catch(() => {});
      return;
    }
    if (path === '/instamart/api/cart/remove-unavailable') {
      unavailable = false;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (path === '/payment') {
      await route.fulfill({ contentType: 'text/html', body: '<body>UPI<br>Pay on Delivery<br>Delivering to Fixture home</body>' });
      return;
    }
    const isCart = path.endsWith('/cart');
    const card = `<section><div data-testid="item-collection-card-full"><img alt="Test Milk"><span class="_1lbNR">Test Milk</span><span class="_3wq_F">500 ml</span><div id="controls"></div></div><span class="_2jn41">₹30</span></section>`;
    const row = `<div role="listitem"><span data-testid="cart-item-name">Test Milk</span><span data-testid="cart-item-quantity">500 ml</span><span data-testid="cart-item-price">₹LINE</span><button data-testid="add_buttons_minus" onclick="change(-1)">−</button><span data-testid="add_buttons_center">COUNT</span></div>`;
    const retained = `<div role="listitem"><span data-testid="cart-item-name">Test Milk</span><span data-testid="cart-item-quantity">500 ml</span><span data-testid="cart-item-price">₹0</span><span data-testid="add_buttons_center">ADD</span></div>`;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body><main></main><div id="sheet"></div><script>
      let quantity = ${persisted};
      let unavailable = ${unavailable};
      const isCart = ${isCart};
      function change(delta) {
        quantity = Math.max(0, quantity + delta);
        const next = quantity;
        setTimeout(() => fetch('/instamart/api/cart', {method:'POST',body:String(next)}).catch(() => {}), ${options.writeDelay || 0});
        render();
        if (document.querySelector('[data-testid="InstamartItemCustomizationWidget"]')) showSheet();
      }
      function startAdd() {
        if (${!!options.variants}) showSheet();
        else { change(1); const c = document.querySelector('#controls'); if (${options.proofDelay || 0}) { c.style.visibility='hidden'; setTimeout(() => c.style.visibility='visible', ${options.proofDelay || 0}); } }
      }
      function showSheet() {
        document.querySelector('#sheet').innerHTML = '<div data-testid="InstamartItemCustomizationWidget">' +
          '<div data-testid="variants-container">1500 ml<span data-testid="variants-price">₹30</span><button data-testid="add_buttons_center" onclick="window.wrongPack=true">ADD</button></div>' +
          '<div data-testid="variants-container">${options.mismatch ? '750 ml' : '500 ml'}<span data-testid="variants-price">₹30</span><button data-testid="add_buttons_center" onclick="if(!quantity)change(1)">' + (quantity || 'ADD') + '</button><button data-testid="add_buttons_plus" onclick="change(1)">+</button></div>' +
          '<button data-testid="InstamartItemCustomizationWidget-cta" onclick="closeSheet()">Done</button></div>';
      }
      function closeSheet() { document.querySelector('#sheet').innerHTML = ''; }
      function openPayment() { location.href = '/payment'; }
      async function removeUnavailable() {
        await fetch('/instamart/api/cart/remove-unavailable', {method:'POST'});
        unavailable = false; render();
      }
      function render() {
        if (isCart) {
          document.querySelector('main').innerHTML = '<div data-testid="item-list-available-items-container">' +
            (quantity ? ${JSON.stringify(row)}.replaceAll('COUNT',quantity).replaceAll('LINE',quantity*30) : ${!!options.retained} ? ${JSON.stringify(retained)} : '') +
            '</div>' + (unavailable ? '<div>Items unavailable<button onclick="removeUnavailable()">Remove all</button></div>' : '') +
            '<div>Bill Details</div><div>Item Total</div><div>₹' + quantity*30 + '</div><div>Handling Fee</div><div>₹2</div><div>To Pay</div><div>₹' + (quantity ? quantity*30+2 : 0) + '</div>' +
            (${!!options.payment} && quantity ? '<button data-testid="cart-generic-footer-button" onclick="openPayment()">Proceed to Pay</button>' : '');
        } else {
          document.querySelector('main').innerHTML = ${JSON.stringify(card)} + ${options.duplicate ? JSON.stringify(card.replaceAll('500 ml', '1 L')) : "''"};
          document.querySelector('#controls').innerHTML = quantity ? '<span data-testid="buttonpair-count">' + quantity + '</span><button data-testid="buttonpair-add" onclick="change(1)">+</button>' :
            ${options.inStock !== false} ? '<button data-testid="buttonpair-add" onclick="startAdd()">ADD</button>' : '<span>Out of stock</span>';
        }
      }
      render();
    </script></body>` });
  });
  const page = await context.newPage();
  await page.goto('https://www.swiggy.com/instamart');
  assert.ok(await page.locator('main > *').count(), 'Fixture script did not render');
  const platform = new SwiggyInstamartPlatform();
  Object.assign(platform, { context, page });
  return { platform, page, context, writes };
}

for (const variants of [false, true]) {
  test(`instamart: ${variants ? 'variant' : 'inline'} ID-only add survives cart navigation and is idempotent`, async () => {
    const { platform, context, writes, page } = await storefront({ variants, delay: 600, writeDelay: 350, retained: true });
    try {
      const result = await platform.search('milk');
      const product = result.products[0];
      assert.equal(product.id, 'Test Milk (500 ml)');
      assert.equal(platform.getProductName(product.id), product.name);
      await platform.getCart();
      assert.equal(await platform.addToCart(product.id, 3), 'added');
      assert.equal(await platform.addToCart(product.id, 3), 'already');
      assert.equal(await page.evaluate(() => !!(window as any).wrongPack), false);
      const cart = await platform.getCart();
      assert.equal(cart?.items[0]?.cartQuantity, 3);
      assert.equal(cart?.items[0]?.price, 30);
      assert.equal(cart?.subtotal, 90);
      assert.equal(cart?.total, 92);
      assert.deepEqual(cart?.fees, [{ label: 'Handling Fee', amount: 2 }]);
      assert.equal(await platform.removeFromCart('Test Milk (1 pack (500 ml))'), true);
      assert.equal((await platform.getCart())?.items.length, 0);
      assert.deepEqual(writes, [1, 2, 3, 2, 1, 0]);
      assert.equal(await platform.addToCart(product.id, 2), 'added');
      assert.equal(await platform.clearCart(), true);
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });
}

test('instamart: stock failures are classified per item', async () => {
  const { platform, context } = await storefront({ inStock: false });
  try {
    assert.equal((await platform.search('milk')).products[0].inStock, false);
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'unavailable');
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('instamart: delayed inline proof is awaited without sending a duplicate add', async () => {
  const { platform, context, writes } = await storefront({ proofDelay: 3500 });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'added');
    assert.deepEqual(writes, [1]);
  } finally { await context.close(); }
});

test('instamart: an unmatched variant never falls back to a different pack', async () => {
  const { platform, context, writes } = await storefront({ variants: true, mismatch: true });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'failed');
    assert.deepEqual(writes, []);
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('instamart: ambiguous bare titles cannot silently select the first pack', async () => {
  const { platform, context, writes } = await storefront({ duplicate: true });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk', 1), 'not-found');
    assert.deepEqual(writes, []);
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'added');
  } finally { await context.close(); }
});

test('instamart: a rejected cart write cannot be reported as a successful add', async () => {
  const { platform, context } = await storefront({ failedWrite: true });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'failed');
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('instamart: clear removes unavailable items too and verifies persistence', async () => {
  const { platform, context } = await storefront({ unavailable: true });
  try {
    assert.equal(await platform.clearCart(), true);
    assert.equal((await platform.getCart())?.items.length, 0);
    assert.equal(await platform.clearCart(), true);
  } finally { await context.close(); }
});

test('instamart: Proceed to Pay footer opens preview without selecting another address', async () => {
  const { platform, context } = await storefront({ payment: true });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'added');
    const preview = await platform.getOrderPreview();
    assert.equal(preview?.cart.total, 32);
    assert.deepEqual(preview?.paymentMethods, ['Pay on Delivery', 'UPI']);
  } finally { await context.close(); }
});

test('instamart: a rejected removal cannot be reported as an empty persisted cart', async () => {
  const { platform, context } = await storefront({ rejectZero: true, writeDelay: 350 });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'added');
    assert.equal(await platform.removeFromCart('Test Milk'), false);
    assert.equal((await platform.getCart())?.items[0]?.cartQuantity, 1);
    assert.equal(await platform.clearCart(), false);
    assert.equal((await platform.getCart())?.items[0]?.cartQuantity, 1);
  } finally { await context.close(); }
});

test('instamart: invalid quantities and partial product labels send no writes', async () => {
  const { platform, context, writes } = await storefront();
  try {
    await platform.search('milk');
    for (const quantity of [0, -1, 1.5, NaN]) assert.equal(await platform.addToCart('Test Milk (500 ml)', quantity), 'failed');
    assert.equal(await platform.addToCart('Test', 1), 'not-found');
    assert.deepEqual(writes, []);
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'added');
    assert.equal(await platform.removeFromCart('Test'), false);
    assert.equal((await platform.getCart())?.items[0]?.cartQuantity, 1);
  } finally { await context.close(); }
});

test('instamart: HTTP 200 address errors are failures with an actionable recovery', async () => {
  const { platform, context } = await storefront({ addressError: true });
  try {
    await platform.search('milk');
    assert.equal(await platform.addToCart('Test Milk (500 ml)', 1), 'failed');
    assert.match(platform.lastAddBlocker || '', /list_addresses\/select_address/);
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('instamart: OTP waits for the auth cookie and saves a session usable after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qc-instamart-login-'));
  const snapshot = join(directory, 'session.json');
  const context = await browser.newContext();
  let restored: BrowserContext | undefined;
  try {
    await context.route('https://www.swiggy.com/**', async route => {
      if (new URL(route.request().url()).pathname === '/fixture-verify') {
        await new Promise(resolve => setTimeout(resolve, 600));
        await route.fulfill({ json: { ok: true } });
        return;
      }
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><body><main><input id="otp" oninput="if(this.value.length===6) verifyOtp()"></main><script>
        async function verifyOtp() {
          document.querySelector('main').innerHTML = 'Verifying';
          await fetch('/fixture-verify',{method:'POST'});
          document.cookie = '_session_tid=fixture-auth;path=/;max-age=86400';
          document.querySelector('main').innerHTML = 'Logged in';
        }
      </script></body>` });
    });
    const page = await context.newPage();
    await page.goto('https://www.swiggy.com/instamart');
    const platform = new SwiggyInstamartPlatform();
    Object.assign(platform, { context, page });
    const storageState = context.storageState.bind(context);
    t.mock.method(context, 'storageState', (options: Parameters<BrowserContext['storageState']>[0]) => storageState({ ...options, path: snapshot }));
    assert.equal(await platform.submitOtp('123456'), true);
    restored = await browser.newContext({ storageState: snapshot });
    const next = new SwiggyInstamartPlatform();
    Object.assign(next, { context: restored, page: await restored.newPage() });
    assert.equal((await next.checkLogin()).loggedIn, true);
  } finally {
    await restored?.close();
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
