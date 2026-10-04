import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyOrder, PaymentTracker } from './payment-tracking.js';
let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

test('redirect URLs do not prove success; contradictory, pending and terminal merchant evidence remain distinct', () => {
  assert.equal(classifyOrder('Order ID 123456').status, 'unknown');
  assert.equal(classifyOrder('Order confirmed. Payment pending').status, 'pending');
  assert.equal(classifyOrder('Order confirmed. Payment failed').status, 'unknown');
  assert.equal(classifyOrder('Your payment has failed. Retry payment').status, 'failed');
  assert.equal(classifyOrder('Your order has been cancelled').status, 'cancelled');
  assert.deepEqual([classifyOrder('Order confirmed').status, classifyOrder('Order confirmed').paymentStatus], ['confirmed', 'unknown']);
  assert.equal(classifyOrder('Payment successful. Order confirmed').paymentStatus, 'paid');
});

for (const [platform, host] of [['bigbasket', 'www.bigbasket.com'], ['blinkit', 'blinkit.com'], ['zepto', 'www.zepto.com'], ['swiggy-instamart', 'www.swiggy.com']]) {
  test(`${platform}: new order redirect resolves once, survives restart, and reconciles only the matching attempt guard`, async () => {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body>Checkout</body>' }));
    const page = await context.newPage();
    await page.goto(`https://${host}/checkout`);
    const directory = mkdtempSync(join(tmpdir(), 'qc-tracking-'));
    const path = join(directory, 'tracking.json'); const guard = join(directory, 'guard.json');
    try {
      const tracker = new PaymentTracker(path, guard);
      await tracker.begin(platform, 'upi_qr', 108, context.pages());
      writeFileSync(guard, JSON.stringify({ status: 'pending', method: 'upi_qr', updatedAt: new Date(Date.now() + 10).toISOString() }), { mode: 0o600 });
      writeFileSync(guard + '.pending', 'pending');
      await page.goto(`https://${host}/member/order-details/track-order/123456`);
      await page.setContent('<body>Order confirmed. Payment pending. Total: ₹108</body>');
      assert.equal((await tracker.inspect(context.pages())).status, 'pending');
      assert.equal(existsSync(guard + '.pending'), true);
      await page.setContent('<body>Payment successful. Order confirmed. Total: ₹108</body>');
      const observed = await new PaymentTracker(path, guard).inspect(context.pages());
      assert.equal(observed.status, 'confirmed'); assert.equal(observed.orderId, '123456'); assert.equal(observed.paymentStatus, 'paid');
      assert.equal(existsSync(guard), false); assert.equal(existsSync(guard + '.pending'), false);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      await page.setContent('Old/unrelated contents');
      assert.equal((await new PaymentTracker(path).inspect([])).status, 'confirmed');
    } finally { await context.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test('old orders, gross amount mismatch, history lists and nonmerchant pages cannot resolve a payment', async () => {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body>Order confirmed. Order ID: 111111. Total: ₹108</body>' }));
  const page = await context.newPage();
  const directory = mkdtempSync(join(tmpdir(), 'qc-tracking-ignore-'));
  try {
    await page.goto('https://www.bigbasket.com/orders/111111');
    const tracker = new PaymentTracker(join(directory, 'tracking.json'));
    await tracker.begin('bigbasket', 'upi_qr', 108, context.pages());
    assert.equal((await tracker.inspect(context.pages())).status, 'pending');
    await page.goto('https://www.bigbasket.com/orders/222222'); await page.setContent('Order confirmed. Total: ₹109');
    assert.equal((await tracker.inspect(context.pages())).status, 'pending');
    await page.goto('https://www.bigbasket.com/account/orders');
    assert.equal((await tracker.inspect(context.pages())).status, 'pending');
    await page.goto('https://bigbasket.com.example.com/orders/222222');
    assert.equal((await tracker.inspect(context.pages())).status, 'pending');
    await assert.rejects(() => tracker.begin('bigbasket', 'wallet', 108, context.pages()), /unresolved/);
  } finally { await context.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('bounded watcher follows new tabs and terminal cancellation without clicking retry', async () => {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body>Your order has been cancelled. Order ID: 123456. Total: ₹108<button onclick="window.retried=true">Retry payment</button></body>' }));
  const directory = mkdtempSync(join(tmpdir(), 'qc-tracking-popup-'));
  try {
    const tracker = new PaymentTracker(join(directory, 'tracking.json'));
    await tracker.begin('bigbasket', 'upi_qr', 108, []);
    const watched = tracker.inspect(() => context.pages(), 1000);
    const popup = await context.newPage(); await popup.goto('https://www.bigbasket.com/orders/123456');
    assert.equal((await watched).status, 'cancelled');
    assert.equal(await popup.evaluate(() => Boolean((window as unknown as { retried?: boolean }).retried)), false);
  } finally { await context.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('another process cannot start a parallel attempt and terminal resolution cannot clear an older guard', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qc-tracking-race-'));
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: 'Your payment has failed. Total: ₹108' }));
  try {
    const path = join(directory, 'tracking.json'); const guard = join(directory, 'guard.json');
    const tracker = new PaymentTracker(path, guard);
    await tracker.begin('bigbasket', 'upi_qr', 108, []);
    await assert.rejects(() => new PaymentTracker(path).begin('bigbasket', 'wallet', 108, []), /unresolved/);
    writeFileSync(guard, JSON.stringify({ status: 'pending', method: 'upi_qr', updatedAt: '2020-01-01T00:00:00Z' }));
    writeFileSync(guard + '.pending', 'pending');
    const page = await context.newPage(); await page.goto('https://www.bigbasket.com/orders/333333');
    assert.equal((await tracker.inspect(context.pages())).status, 'failed');
    assert.equal(existsSync(guard), true);
    assert.equal(existsSync(path + '.pending'), false);
    await tracker.begin('bigbasket', 'upi_qr', 108, context.pages());
    tracker.abandonUnsubmitted();
    assert.equal(existsSync(path + '.pending'), false);
  } finally { await context.close(); rmSync(directory, { recursive: true, force: true }); }
});
