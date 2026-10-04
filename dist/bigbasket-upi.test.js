import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BigBasketUpiCheckout, readBigBasketQr } from './bigbasket-upi.js';
import { WalletCheckout } from './wallet.js';
const fixtureGif = 'data:image/gif;base64,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';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
const preview = () => ({ address: 'Home 560102', paymentMethods: ['UPI'], cart: {
        platform: 'bigbasket', subtotal: 100, deliveryFee: 8, total: 108,
        items: [{ id: '1', name: 'Biscuits', quantity: '1 kg', price: 100, inStock: true, platform: 'bigbasket', cartQuantity: 1 }],
    } });
async function fixture(ambiguous = false) {
    const page = await browser.newPage();
    const html = `<div role="button" aria-label="Generate QR Code" onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#qr').innerHTML='<img src=${fixtureGif} width=210 height=210><p>Approve payment within:</p><p>09:59</p>'">Generate QR Code</div>${ambiguous ? '<button>Generate QR Code</button>' : ''}<div id="qr"></div>`;
    await page.setContent(`<iframe name="HyperServices" width="600" height="600" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`);
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
        assert.match(result.message, /09:59/);
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
test('responsive display stretching does not prevent decoding the original GIF pixels', async () => {
    const page = await fixture();
    try {
        await page.frames()[1].getByRole('button').click(); // Local fixture only; no merchant/payment requests.
        await page.frames()[1].locator('img').evaluate(e => { e.style.width = '142px'; e.style.height = '210px'; });
        const result = await readBigBasketQr(page, 108);
        assert.equal(result.details.amount, 108);
        assert.equal(result.details.width, 210);
        assert.equal(result.details.height, 210);
        assert.match(result.expiry, /09:59/);
    }
    finally {
        await page.close();
    }
});
//# sourceMappingURL=bigbasket-upi.test.js.map