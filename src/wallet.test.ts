import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { inspectWallet, WalletCheckout } from './wallet.js';
import type { OrderPreview } from './platforms/base.js';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
const preview = (total = 100): OrderPreview => ({ address: 'Home, Bangalore 560102', paymentMethods: ['Wallets'],
  cart: { platform: 'bigbasket', items: [{ id: '1', name: 'Biscuits', price: total, quantity: '1 pack', cartQuantity: 1, inStock: true, platform: 'bigbasket' }], subtotal: total, deliveryFee: 0, total } });

async function fixture(page: Page, options: { name?: string; balance?: number; total?: number; pending?: boolean; disabled?: boolean; linked?: boolean } = {}) {
  const { name = 'bbWallet', balance = 200, total = 100, pending = false, disabled = false, linked = false } = options;
  await page.evaluate(() => { (window as unknown as { submitted: number }).submitted = 0; });
  await page.setContent(`<div><span>${name}</span><input type="${linked ? 'radio' : 'checkbox'}" ${disabled ? 'disabled' : ''}
    onclick="document.querySelector('#applied').textContent='₹${total}'; document.querySelector('#due').textContent='To pay: ₹0'"><span id="applied">₹0</span><span>Balance: ₹${balance}</span></div>
    <div id="due">To pay: ₹${total}</div><button onclick="window.submitted=(window.submitted||0)+1;document.querySelector('#result').textContent='${pending ? 'Payment pending: enter OTP' : 'Order confirmed Order ID: BB123456'}'">Place Order</button><div id="result"></div>`);
}
const clicks = (page: Page) => page.evaluate(() => (window as unknown as { submitted?: number }).submitted ?? 0);

for (const [platform, name] of [['bigbasket', 'bbWallet'], ['blinkit', 'Blinkit Wallet'], ['zepto', 'Zepto Cash'], ['swiggy-instamart', 'Swiggy Money']]) {
  test(`${platform}: full wallet checkout requires preparation and reports a confirmed order`, async () => {
    const page = await browser.newPage();
    try {
      await fixture(page, { name });
      const checkout = new WalletCheckout();
      assert.equal((await checkout.prepare(page, platform, preview())).ready, true);
      assert.equal(await clicks(page), 0);
      assert.equal(await page.locator('input').isChecked(), false);
      const result = await checkout.submit(page, platform, preview(), name);
      assert.equal(result.success, true);
      assert.equal(result.orderId, 'BB123456');
      assert.equal(await clicks(page), 1);
      assert.equal((await checkout.submit(page, platform, preview(), name)).submitted, false);
      assert.equal(await clicks(page), 1);
    } finally { await page.close(); }
  });
}

test('equal balance covers the bill to the paise; insufficient and disabled wallets never submit', async () => {
  const page = await browser.newPage();
  try {
    await fixture(page, { total: 133.94, balance: 133.94 });
    assert.equal((await inspectWallet(page, 'bigbasket', 133.94)).status, 'ready');
    await fixture(page, { balance: 99.99 });
    const status = await inspectWallet(page, 'bigbasket', 100);
    assert.equal(status.status, 'insufficient_balance'); assert.equal(status.shortfall, 0.01);
    const checkout = new WalletCheckout();
    assert.equal((await checkout.prepare(page, 'bigbasket', preview())).ready, false);
    assert.equal((await checkout.submit(page, 'bigbasket', preview())).submitted, false);
    await fixture(page, { disabled: true });
    assert.equal((await inspectWallet(page, 'bigbasket', 100)).status, 'unavailable');
    assert.equal(await clicks(page), 0);
  } finally { await page.close(); }
});

test('changed cart/address/total or a depleted balance invalidates wallet approval', async () => {
  const page = await browser.newPage();
  try {
    const checkout = new WalletCheckout();
    for (const changed of [{ ...preview(), address: 'Different address' }, preview(101),
      { ...preview(), cart: { ...preview().cart, items: [{ ...preview().cart.items[0], cartQuantity: 2 }] } }]) {
      await fixture(page); await checkout.prepare(page, 'bigbasket', preview());
      assert.equal((await checkout.submit(page, 'bigbasket', changed)).submitted, false);
    }
    await fixture(page); await checkout.prepare(page, 'bigbasket', preview());
    await fixture(page, { balance: 50 });
    assert.equal((await checkout.submit(page, 'bigbasket', preview())).submitted, false);
    assert.equal(await clicks(page), 0);
  } finally { await page.close(); }
});

for (const platform of ['bigbasket', 'blinkit', 'zepto', 'swiggy-instamart']) {
test(`${platform}: linked wallet balance can pay; authentication remains an uncertain one-shot outcome`, async () => {
  const page = await browser.newPage();
  try {
    const checkout = new WalletCheckout();
    await fixture(page, { name: 'Amazon Pay', linked: true });
    assert.equal((await checkout.prepare(page, platform, preview(), 'Amazon Pay')).ready, true);
    assert.equal((await checkout.submit(page, platform, preview(), 'Amazon Pay')).success, true);
    await fixture(page, { name: 'MobiKwik', linked: true, pending: true });
    await checkout.prepare(page, platform, preview(), 'MobiKwik');
    const result = await checkout.submit(page, platform, preview(), 'MobiKwik');
    assert.equal(result.success, false); assert.equal(result.submitted, true); assert.equal(result.status, 'unknown');
    assert.equal((await checkout.prepare(page, platform, preview(), 'MobiKwik')).ready, false);
    assert.equal((await checkout.submit(page, platform, preview(), 'MobiKwik')).submitted, false);
    assert.equal(await clicks(page), 1);
  } finally { await page.close(); }
});
}

test('unresolved wallet attempts survive process/controller recreation and keep private journal permissions', async () => {
  const page = await browser.newPage();
  const directory = mkdtempSync(join(tmpdir(), 'qc-wallet-journal-'));
  const path = join(directory, 'wallet-attempt.json');
  try {
    await fixture(page, { pending: true });
    const checkout = new WalletCheckout(path);
    await checkout.prepare(page, 'bigbasket', preview());
    assert.equal((await checkout.submit(page, 'bigbasket', preview())).status, 'unknown');
    const restored = new WalletCheckout(path);
    assert.equal((await restored.prepare(page, 'bigbasket', preview())).ready, false);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(await clicks(page), 1);
  } finally { await page.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('missing balance, unlinked provider, provider mismatch and ambiguous final controls remain manual', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div>Amazon Pay<input type="radio"><span>Link wallet</span></div>');
    assert.equal((await inspectWallet(page, 'bigbasket', 100, 'Amazon Pay')).status, 'manual');
    await fixture(page);
    assert.equal((await inspectWallet(page, 'bigbasket', 100, 'Amazon Pay')).status, 'manual');
    const checkout = new WalletCheckout();
    await checkout.prepare(page, 'bigbasket', preview());
    await page.locator('body').evaluate(e => { e.insertAdjacentHTML('beforeend', '<button>Pay Now</button>'); });
    assert.equal((await checkout.submit(page, 'bigbasket', preview())).submitted, false);
    assert.equal(await clicks(page), 0);
  } finally { await page.close(); }
});
