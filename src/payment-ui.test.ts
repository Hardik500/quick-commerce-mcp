import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { inspectPayments, preparePaymentPanel } from './payment-ui.js';

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

test('BigBasket Juspay article categories open UPI details but cannot submit COD', async () => {
  const page = await browser.newPage();
  try {
    const html = '<article role="none" onclick="document.querySelector(\'#details\').innerHTML=\'<input placeholder=&quot;Enter UPI ID&quot;><button onclick=&quot;window.submitted=true&quot;>Send collect request</button>\'">UPI</article><article role="none" onclick="window.submitted=true">Pay on delivery</article><div id="details"></div>';
    await page.setContent(`<iframe name="HyperServices" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`);
    const result = await preparePaymentPanel(page, 'bigbasket', ['UPI', 'Pay on delivery'], {});
    assert.equal(result.opened, true);
    assert.equal(result.plan.selected?.method, 'upi_collect');
    assert.equal((await preparePaymentPanel(page, 'bigbasket', ['Pay on delivery'], { order: ['cod'] })).opened, false);
    assert.equal(await page.frames()[1].evaluate(() => Boolean((window as unknown as { submitted?: boolean }).submitted)), false);
  } finally { await page.close(); }
});

for (const platform of ['zepto', 'blinkit', 'swiggy-instamart', 'bigbasket']) {
  test(`${platform}: preparation opens UPI category, discovers QR, and never submits`, async () => {
    const page = await browser.newPage();
    try {
      const html = '<button role="tab" onclick="document.querySelector(\'#details\').innerHTML=\'<button onclick=&quot;window.submitted=true&quot;>Pay via QR Code</button>\'">UPI</button><div id="details"></div>';
      if (platform === 'bigbasket') await page.setContent(`<iframe name="HyperServices" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`);
      else await page.setContent(html);
      const result = await preparePaymentPanel(page, platform, ['UPI'], {});
      assert.equal(result.opened, true);
      assert.equal(result.plan.selected?.method, 'upi_qr');
      const root = platform === 'bigbasket' ? page.frames()[1] : page;
      assert.equal(await root.evaluate(() => Boolean((window as unknown as { submitted?: boolean }).submitted)), false);
    } finally { await page.close(); }
  });
}

test('final COD/provider buttons are never treated as safe category controls', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<button onclick="window.submitted=true">Cash on Delivery</button>');
    const result = await preparePaymentPanel(page, 'swiggy-instamart', ['Cash on Delivery'], { order: ['cod'] });
    assert.equal(result.opened, false);
    assert.equal(await page.evaluate(() => Boolean((window as unknown as { submitted?: boolean }).submitted)), false);
  } finally { await page.close(); }
});

test('exact UPI category buttons open details while the collect submit button remains untouched', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<button onclick="document.querySelector(\'#details\').innerHTML=\'<input placeholder=&quot;Enter UPI ID&quot;><button onclick=&quot;window.submitted=true&quot;>Send collect request</button>\'">UPI</button><div id="details"></div>');
    const result = await preparePaymentPanel(page, 'swiggy-instamart', ['UPI'], {});
    assert.equal(result.opened, true);
    assert.equal(result.plan.selected?.method, 'upi_collect');
    assert.equal(await page.evaluate(() => Boolean((window as unknown as { submitted?: boolean }).submitted)), false);
  } finally { await page.close(); }
});

test('explicit disabled category overrides misleading text labels, and ambiguous tabs are refused', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<button role="tab" aria-disabled="true" aria-label="Cash">Cash</button><button role="tab">Wallets</button>');
    const options = await inspectPayments(page, 'blinkit', ['Cash on Delivery', 'Wallets']);
    assert.equal(options.filter(o => o.method === 'cod' && o.enabled).length, 0);
    await page.setContent('<button role="tab">UPI</button><button role="tab">UPI</button>');
    assert.equal((await preparePaymentPanel(page, 'bigbasket', ['UPI'], {})).opened, false);
    await assert.rejects(preparePaymentPanel(page, 'bigbasket', ['UPI'], {}, 'missing-option'), /absent or disabled/);
  } finally { await page.close(); }
});
