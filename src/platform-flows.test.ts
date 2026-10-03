import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlinkitPlatform } from './platforms/blinkit.js';
import { ZeptoPlatform } from './platforms/zepto.js';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.QC_CHROME_PATH || undefined,
    headless: true,
  });
});
after(async () => { await browser?.close(); });

// Serve deterministic storefronts at the browser/network boundary. The tests
// exercise the public platform methods using real DOM queries and clicks.
async function storefront(kind: 'blinkit' | 'zepto', proofDelay = 0, closed = false, inStock = true, keepRemovedCard = false, mutationDelay = 0, blinkitCartId = '') {
  const context = await browser.newContext();
  const origin = kind === 'blinkit' ? 'https://blinkit.com' : 'https://www.zeptonow.com';
  let persistedQuantity = mutationDelay ? 3 : null;
  await context.addCookies([{ name: kind === 'blinkit' ? 'gr_1_accessToken' : 'user_id', value: 'fixture-account', url: origin }]);
  await context.addInitScript(() => {
    if (!localStorage.getItem('auth')) localStorage.setItem('auth', JSON.stringify({ accessToken: 'fixture-account', phoneNumber: 'fixture-phone' }));
    if (!localStorage.getItem('user')) localStorage.setItem('user', JSON.stringify({ profile: { id: 'fixture-user' } }));
  });
  await context.route(`${origin}/**`, async route => {
    if (new URL(route.request().url()).pathname === '/cfs/api/v1/cart' || /^\/v5\/carts(?:\/\d+)?$/.test(new URL(route.request().url()).pathname)) {
      const next = Number(route.request().postData());
      if (mutationDelay) await new Promise(resolve => setTimeout(resolve, mutationDelay));
      persistedQuantity = next;
      await route.fulfill({ json: { quantity: next } }).catch(() => {});
      return;
    }
    const cart = new URL(route.request().url()).pathname === '/cart';
    const card = kind === 'blinkit'
      ? `<div id="101"><span class="tw-text-300 tw-font-semibold tw-line-clamp-2">Test Milk</span><span class="tw-text-200 tw-font-medium tw-line-clamp-1">500 ml</span><span class="tw-text-200 tw-font-semibold">₹30</span><div id="controls"></div></div>`
      : `<a data-testid="product-card" href="/test-milk/pvid/101"><span data-slot-id="ProductName">Test Milk</span><div>500 ml</div><span data-slot-id="EdlpPrice">₹30</span><div id="controls"></div></a>`;
    const row = kind === 'blinkit'
      ? `<div class="CartProduct__Container"><span class="DefaultProductCard__ProductTitle">Test Milk</span><span class="DefaultProductCard__ProductVariantContainer">500 ml</span><span class="DefaultProductCard__Price-">₹30</span><div class="AddToCart__UpdatedButtonContainer"><button class="AddToCart___StyledDiv-" onclick="change(-1)">−</button>QUANTITY<button onclick="change(1)">+</button></div></div>`
      : `<div><a href="/test-milk/pvid/101"><span class="__4sxPD">Test Milk</span><span class="K96_o">500 ml</span></a><span>₹LINE_TOTAL</span><button data-testid="101-minus-btn" onclick="change(-1)">−</button><span data-testid="101-cart-qty">QUANTITY</span></div>`;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body><main></main><script>
      const isCart = ${cart};
      if (isCart && ${mutationDelay > 0} && ${persistedQuantity !== null}) localStorage.setItem('quantity', ${persistedQuantity});
      const card = ${JSON.stringify(card)};
      const row = ${JSON.stringify(row)};
      const removedRow = '<div class="CartProduct__Container"><span class="DefaultProductCard__ProductTitle">Test Milk</span><span class="DefaultProductCard__Price-">₹30</span><div class="AddToCart__UpdatedButtonContainer">ADD</div></div>';
      function qty() { return Number(localStorage.getItem('quantity') || 0); }
      function change(delta) {
        localStorage.setItem('quantity', Math.max(0, qty() + delta));
        if (${kind === 'blinkit'}) fetch(${JSON.stringify('/v5/carts' + (blinkitCartId ? '/' + blinkitCartId : ''))}, { method: ${JSON.stringify(blinkitCartId ? 'PUT' : 'POST')}, body: String(qty()) }).catch(() => {});
        if (${kind === 'zepto'} && (qty() || ${mutationDelay})) fetch('/cfs/api/v1/cart', { method: 'PUT', body: String(qty()) }).catch(() => {});
        render();
      }
      function render() {
        if (isCart) {
          document.querySelector('main').innerHTML = qty() ? row.replaceAll('QUANTITY', qty()).replaceAll('LINE_TOTAL', qty() * 30) : ${keepRemovedCard} ? removedRow : '<div class="flex justify-between"><span>To Pay</span><span>₹0</span></div>';
        } else {
          document.querySelector('main').innerHTML = card;
          document.querySelector('#controls').innerHTML = qty()
            ? '<button aria-label="Decrease quantity" onclick="event.preventDefault();change(-1)"><i class="icon-minus"></i>−</button><span>' + qty() + '</span><button aria-label="Increase quantity" onclick="event.preventDefault();change(1)"><i class="icon-plus"></i>+</button>'
            : ${inStock} ? '<button class="tw-bg-green-050" onclick="event.preventDefault();change(1);hideProof()">ADD</button>' : '<span data-testid="out-of-stock">Out of stock</span>';
        }
        if (isCart && qty() && ${closed}) {
          const modal = document.createElement('div');
          modal.className = 'ReactModal__Content';
          modal.style = 'position:fixed;inset:0;z-index:999;background:white';
          modal.innerHTML = '<div>Store closed</div><button class="DialogButton__Button" onclick="this.parentElement.remove()">Okay</button>';
          document.body.appendChild(modal);
        }
      }
      function hideProof() {
        if (!${proofDelay}) return;
        const controls = document.querySelector('#controls');
        controls.style.visibility = 'hidden';
        setTimeout(() => controls.style.visibility = 'visible', ${proofDelay});
      }
      render();
    </script></body>` });
  });
  const page = await context.newPage();
  await page.goto(origin);
  const platform = kind === 'blinkit' ? new BlinkitPlatform() : new ZeptoPlatform();
  // Bind the real browser to the adapter; initialization's live interstitials
  // are outside this controlled storefront's scope.
  Object.assign(platform, { page, context });
  return { platform, page, context };
}

test('blinkit: a legacy cookie without authenticated client state is not a login', async () => {
  const { platform, page, context } = await storefront('blinkit');
  try {
    await page.evaluate(() => {
      localStorage.setItem('auth', JSON.stringify({ accessToken: null, phoneNumber: null }));
      localStorage.setItem('user', JSON.stringify({ profile: {} }));
    });
    assert.equal((await platform.checkLogin()).loggedIn, false);
  } finally { await context.close(); }
});

async function loginStorefront(context: BrowserContext, delay = 600) {
  await context.route('https://blinkit.com/**', async route => {
    if (new URL(route.request().url()).pathname === '/fixture-verify-otp') {
      // OTP inputs disappear while verification/client hydration is pending.
      await new Promise(resolve => setTimeout(resolve, delay));
      await route.fulfill({ json: { ok: true } }).catch(() => {});
      return;
    }
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>
      <button class="LocationBar__Subtitle" onclick="showAddresses()">Delivery location</button>
      <main></main><script>
        function authenticated() { return !!JSON.parse(localStorage.getItem('auth') || '{}').accessToken; }
        if (!authenticated()) document.querySelector('main').innerHTML = '<input type="password" maxlength="4" data-test-id="otp-text-box" oninput="if(this.value.length===4) verifyOtp()">';
        async function verifyOtp() {
          document.querySelector('main').innerHTML = 'Verifying login';
          await fetch('/fixture-verify-otp', {method:'POST'});
          localStorage.setItem('auth', JSON.stringify({accessToken:'fixture-auth',phoneNumber:'fixture-phone'}));
          localStorage.setItem('user', JSON.stringify({profile:{id:'fixture-user'}}));
          document.cookie = 'gr_1_accessToken=fixture-auth;path=/';
          document.querySelector('main').innerHTML = 'Logged in';
        }
        function showAddresses() {
          document.querySelector('main').innerHTML = authenticated()
            ? '<div class="AddressListItem__AddressItemWrapperItem">Fixture home<br>Fixture lane, Test city, 560102</div>'
            : 'Select delivery location';
        }
      </script></body>` });
  });
  const page = await context.newPage();
  await page.goto('https://blinkit.com');
  const platform = new BlinkitPlatform();
  Object.assign(platform, { context, page });
  return { platform, page };
}

test('blinkit: OTP success persists a session usable by a fresh browser', async t => {
  const taskSnapshotDir = await mkdtemp(join(tmpdir(), 'qc-login-test-'));
  const snapshot = join(taskSnapshotDir, 'session.json');
  const context = await browser.newContext();
  let restored: BrowserContext | undefined;
  try {
    await context.addCookies([{ name: 'gr_1_accessToken', value: 'stale-fixture-cookie', url: 'https://blinkit.com' }]);
    const { platform } = await loginStorefront(context);
    // Redirect the external browser's file write, never a user's saved session.
    const storageState = context.storageState.bind(context);
    t.mock.method(context, 'storageState', (options: Parameters<BrowserContext['storageState']>[0]) => storageState({ ...options, path: snapshot }));
    assert.equal(await platform.submitOtp('1234'), true);
    restored = await browser.newContext({ storageState: snapshot });
    const next = await loginStorefront(restored);
    assert.equal((await next.platform.checkLogin()).loggedIn, true);
    assert.equal((await next.platform.getAddresses()).length, 1);
  } finally {
    await restored?.close();
    await context.close();
    await rm(taskSnapshotDir, { recursive: true, force: true });
  }
});

test('blinkit: the store-closed dialog permits cart removal and clearing', async () => {
  const { platform, page, context } = await storefront('blinkit', 0, true);
  page.setDefaultTimeout(1000);
  try {
    await page.evaluate(() => localStorage.setItem('quantity', '3'));
    assert.equal((await platform.getCart())?.notice, 'Store closed');
    assert.equal(await platform.removeFromCart('Test Milk'), true);
    await page.evaluate(() => localStorage.setItem('quantity', '2'));
    assert.equal(await platform.clearCart(), true);
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('blinkit: a cart with missing bill rows still reports its item total', async () => {
  const { platform, page, context } = await storefront('blinkit');
  try {
    await page.evaluate(() => localStorage.setItem('quantity', '3'));
    const cart = await platform.getCart();
    assert.equal(cart?.subtotal, 90);
    assert.equal(cart?.total, 90);
  } finally { await context.close(); }
});

test('blinkit: a removed row showing ADD is no longer counted as a cart item', async () => {
  const { platform, page, context } = await storefront('blinkit', 0, false, true, true);
  try {
    await page.evaluate(() => localStorage.setItem('quantity', '3'));
    assert.equal(await platform.removeFromCart('Test Milk'), true);
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

test('zepto: removal and clearing wait for persisted mutations before cart reload', async () => {
  const { platform, page, context } = await storefront('zepto', 0, false, true, false, 600);
  try {
    await page.evaluate(() => localStorage.setItem('quantity', '3'));
    assert.equal(await platform.removeFromCart('Test Milk'), true);
    assert.equal((await platform.getCart())?.items.length, 0);
    await page.evaluate(async () => {
      localStorage.setItem('quantity', '3');
      await fetch('/cfs/api/v1/cart', { method: 'PUT', body: '3' });
    });
    assert.equal(await platform.clearCart(), true);
    assert.equal((await platform.getCart())?.items.length, 0);
  } finally { await context.close(); }
});

for (const cartId of ['', '42']) {
  test(`blinkit: ${cartId ? 'existing' : 'new'} cart removal and clearing wait for persisted mutations before reload`, async () => {
    const { platform, page, context } = await storefront('blinkit', 0, false, true, true, 600, cartId);
    try {
      await page.evaluate(() => localStorage.setItem('quantity', '3'));
      assert.equal(await platform.removeFromCart('Test Milk'), true);
      assert.equal((await platform.getCart())?.items.length, 0);
      await page.evaluate(async () => {
        localStorage.setItem('quantity', '2');
        await fetch('/v5/carts', { method: 'POST', body: '2' });
      });
      assert.equal(await platform.clearCart(), true);
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });
}

for (const kind of ['blinkit', 'zepto'] as const) {
  test(`${kind}: out-of-stock products are item failures, not page-wide blockers`, async () => {
    const { platform, context } = await storefront(kind, 0, false, false);
    try {
      const result = await platform.search('milk');
      assert.equal(result.products[0].inStock, false);
      assert.equal(await platform.addToCart('101', 1), 'unavailable');
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });

  test(`${kind}: remove accepts the search label including its pack size`, async () => {
    const { platform, page, context } = await storefront(kind);
    try {
      await page.evaluate(() => localStorage.setItem('quantity', '3'));
      assert.equal(await platform.removeFromCart('Test Milk (1 pack (500 ml))'), true);
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });

  test(`${kind}: clear removes every unit and adding an existing card does not duplicate it`, async () => {
    const { platform, context } = await storefront(kind);
    try {
      await platform.search('milk');
      assert.equal(await platform.addToCart('101', 3), 'added');
      assert.equal(await platform.addToCart('101', 3), 'already');
      assert.equal((await platform.getCart())?.items[0]?.cartQuantity, 3);
      assert.equal(await platform.clearCart(), true);
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });

  test(`${kind}: an attached stepper may become visible after the add`, async () => {
    const { platform, context } = await storefront(kind, 700);
    try {
      await platform.search('milk');
      assert.equal(await platform.addToCart('101', 1), 'added');
      assert.equal((await platform.getCart())?.items[0]?.cartQuantity, 1);
    } finally { await context.close(); }
  });

  test(`${kind}: product IDs from search remain addable after reading the cart`, async () => {
    const { platform, context } = await storefront(kind);
    try {
      const result = await platform.search('milk');
      assert.equal(result.products[0].id, '101');
      assert.equal((platform as any).getProductName('101'), 'Test Milk');
      await platform.getCart();
      assert.equal(await platform.addToCart(result.products[0].id, 3), 'added');
      const cart = await platform.getCart();
      assert.equal(cart?.items[0]?.cartQuantity, 3);
      assert.equal(cart?.subtotal, 90);
      assert.equal(cart?.total, 90);
      assert.equal(await platform.removeFromCart('Test Milk'), true);
      assert.equal((await platform.getCart())?.items.length, 0);
    } finally { await context.close(); }
  });
}
