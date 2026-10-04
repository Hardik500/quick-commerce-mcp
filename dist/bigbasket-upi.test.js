import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BigBasketUpiCheckout } from './bigbasket-upi.js';
import { WalletCheckout } from './wallet.js';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
const preview = () => ({ address: 'Home 560102', paymentMethods: ['UPI'], cart: {
        platform: 'bigbasket', subtotal: 100, deliveryFee: 8, total: 108,
        items: [{ id: '1', name: 'Biscuits', quantity: '1 kg', price: 100, inStock: true, platform: 'bigbasket', cartQuantity: 1 }],
    } });
async function fixture(ambiguous = false) {
    const page = await browser.newPage();
    const html = `<div role="button" aria-label="Generate QR Code" onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#qr').innerHTML='<canvas width=200 height=200></canvas><p>Valid for 03:00</p>'">Generate QR Code</div>${ambiguous ? '<button>Generate QR Code</button>' : ''}<div id="qr"></div>`;
    await page.setContent(`<iframe name="HyperServices" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`);
    return page;
}
test('BigBasket QR preparation never dispatches; confirmed generation returns a pending PNG, never a paid order', async () => {
    const page = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'qc-qr-'));
    const journal = join(directory, 'payment.json');
    try {
        const checkout = new BigBasketUpiCheckout(journal);
        assert.equal((await checkout.submit(page, preview())).submitted, false);
        assert.equal((await checkout.prepare(page, preview())).ready, true);
        assert.equal(await page.frames()[1].evaluate(() => Boolean(window.clicks)), false);
        const result = await checkout.submit(page, preview());
        assert.equal(result.success, true);
        assert.equal(result.status, 'pending');
        assert.equal(result.submitted, true);
        assert.equal(result.image?.subarray(1, 4).toString(), 'PNG');
        assert.match(result.message, /not confirmed/);
        assert.equal(JSON.parse(readFileSync(journal, 'utf8')).method, 'upi_qr');
        assert.equal(statSync(journal).mode & 0o777, 0o600);
        assert.equal((await checkout.submit(page, preview())).submitted, false);
        assert.equal((await new BigBasketUpiCheckout(journal).prepare(page, preview())).ready, undefined);
        const wallet = await new WalletCheckout(journal).prepare(page, 'bigbasket', preview());
        assert.equal(wallet.ready, false); // Shared guard forbids fallback after a QR attempt.
        assert.equal(await page.frames()[1].evaluate(() => window.clicks), 1);
    }
    finally {
        await page.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
test('BigBasket QR rejects changed cart, address or amount and ambiguous or disabled controls before dispatch', async () => {
    const page = await fixture();
    try {
        for (const change of [(p) => { p.address = 'Other'; },
            (p) => { p.cart.total += 1; }, (p) => { p.cart.items[0].cartQuantity++; }]) {
            const checkout = new BigBasketUpiCheckout();
            assert.equal((await checkout.prepare(page, preview())).ready, true);
            const changed = preview();
            change(changed);
            assert.equal((await checkout.submit(page, changed)).submitted, false);
        }
        await page.frames()[1].getByRole('button').evaluate(e => e.setAttribute('aria-disabled', 'true'));
        assert.equal((await new BigBasketUpiCheckout().prepare(page, preview())).ready, undefined);
        assert.equal(await page.frames()[1].evaluate(() => Boolean(window.clicks)), false);
    }
    finally {
        await page.close();
    }
    const ambiguous = await fixture(true);
    try {
        assert.equal((await new BigBasketUpiCheckout().prepare(ambiguous, preview())).ready, undefined);
    }
    finally {
        await ambiguous.close();
    }
});
test('a lost QR dispatch response stays unknown and cannot be retried after a process restart', async () => {
    const page = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'qc-qr-unknown-'));
    const journal = join(directory, 'payment.json');
    try {
        const checkout = new BigBasketUpiCheckout(journal);
        await checkout.prepare(page, preview());
        await page.frames()[1].getByRole('button').evaluate(e => e.setAttribute('onclick', 'window.clicks=(window.clicks||0)+1'));
        // Fail after dispatch, as a dropped frame/browser connection could do.
        const original = page.waitForTimeout.bind(page);
        page.waitForTimeout = async () => { throw new Error('lost response'); };
        const result = await checkout.submit(page, preview());
        page.waitForTimeout = original;
        assert.equal(result.status, 'unknown');
        assert.equal(result.submitted, true);
        assert.equal(new BigBasketUpiCheckout(journal).hasPending(), true);
        assert.equal((await checkout.submit(page, preview())).submitted, false);
        assert.equal(await page.frames()[1].evaluate(() => window.clicks), 1);
    }
    finally {
        await page.close();
        rmSync(directory, { recursive: true, force: true });
    }
});
test('an existing QR is not reused or regenerated without reconciliation', async () => {
    const page = await fixture();
    try {
        await page.frames()[1].locator('#qr').evaluate(e => { e.innerHTML = '<canvas width="200" height="200"></canvas>'; });
        const checkout = new BigBasketUpiCheckout();
        assert.equal((await checkout.prepare(page, preview())).ready, undefined);
        assert.equal((await checkout.submit(page, preview())).submitted, false);
        assert.equal(await page.frames()[1].evaluate(() => Boolean(window.clicks)), false);
    }
    finally {
        await page.close();
    }
});
//# sourceMappingURL=bigbasket-upi.test.js.map