import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BlinkitPlatform } from './platforms/blinkit.js';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
async function fixture(mode, polling = false) {
    const context = await browser.newContext();
    await context.route('https://blinkit.com/**', async (route) => {
        if (new URL(route.request().url()).pathname === '/analytics')
            return;
        const row = '<div class="CartProduct__Container"><span class="DefaultProductCard__ProductTitle">Test Milk</span><span class="DefaultProductCard__ProductVariantContainer">500 ml</span><span class="DefaultProductCard__Price-">₹30</span><div class="AddToCart__UpdatedButtonContainer">1</div></div>';
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html>${row}
      <div class="BillCard__BillItemContainer">Items total ₹30</div>
      <section><div><span>Delivering to</span><span>Fixture Home</span></div></section>
      <button style="display:none">Proceed</button><div id="flow"></div>
      <script>
      window.submitted=false;window.addressClicks=0;window.checkoutClicks=0;
      addEventListener('message',()=>window.submitted=true);
      function payment(){document.querySelector('#flow').innerHTML='<iframe src="https://payments.test/zpaykit/"></iframe>'}
      function list(){document.querySelector('#flow').innerHTML='<div class="AddressList__AddressLists"><button onclick="window.addressClicks++">Home B 013 Fixture</button><button onclick="window.addressClicks++">Home B 013 Fixture</button></div>'}
      const mode=${JSON.stringify(mode)};
      if(mode==='payment')payment();
      if(mode==='pay')document.querySelector('#flow').innerHTML='<button onclick="window.checkoutClicks++;payment()">Proceed to pay ₹30</button>';
      if(mode==='ambiguous')document.querySelector('#flow').innerHTML='<button onclick="list()">Proceed</button>';
      if(mode==='closed')document.querySelector('#flow').innerHTML='<div class="ReactModal__Content">Store is currently closed<button class="DialogButton__Button" onclick="this.parentElement.remove()">Okay</button></div><button onclick="window.checkoutClicks++">Proceed to pay</button>';
      if(${polling})setInterval(()=>fetch('/analytics').catch(()=>{}),50);
      </script>` });
    });
    await context.route('https://payments.test/zpaykit/', route => route.fulfill({ contentType: 'text/html', body: `<h5>UPI</h5><p>Select UPI APP</p><p>Google Pay</p><button onclick="parent.postMessage(1,'*')">Pay Now</button>` }));
    const page = await context.newPage();
    await page.goto('https://blinkit.com/cart');
    const platform = new BlinkitPlatform();
    Object.assign(platform, { context, page });
    return { context, page, platform };
}
test('Blinkit cart readiness ignores continuous analytics requests', async () => {
    const { platform, context } = await fixture('pay', true);
    try {
        const start = performance.now();
        assert.equal((await platform.getCart())?.total, 30);
        assert.ok(performance.now() - start < 3000, 'cart should not wait eight seconds for network inactivity');
    }
    finally {
        await context.close();
    }
});
for (const mode of ['pay', 'payment']) {
    test(`Blinkit ${mode}: preview accepts casing changes or an already-open payment panel without submitting`, async () => {
        const { platform, context, page } = await fixture(mode);
        try {
            const preview = await platform.getOrderPreview();
            assert.equal(preview?.cart.total, 30);
            assert.match(preview?.address ?? '', /Fixture Home/);
            assert.ok(preview?.paymentMethods.includes('UPI'));
            assert.equal(await page.evaluate(() => window.submitted), false);
            assert.equal(await page.evaluate(() => window.checkoutClicks), mode === 'pay' ? 1 : 0);
        }
        finally {
            await context.close();
        }
    });
}
test('Blinkit closed-store checkout fails immediately without clicking checkout', async () => {
    const { platform, context, page } = await fixture('closed');
    try {
        const start = performance.now();
        await assert.rejects(platform.getOrderPreview(), /checkout unavailable.*closed/i);
        assert.ok(performance.now() - start < 3000);
        assert.equal(await page.evaluate(() => window.checkoutClicks), 0);
    }
    finally {
        await context.close();
    }
});
test('Blinkit ambiguous chosen addresses never fall back to the first saved row', async () => {
    const { platform, context, page } = await fixture('ambiguous');
    Object.assign(platform, { selectedAddress: { id: '0', label: 'Home', addressLine1: 'B 013 Fixture' } });
    try {
        await assert.rejects(platform.getOrderPreview(), /absent or ambiguous/);
        assert.equal(await page.evaluate(() => window.addressClicks), 0);
    }
    finally {
        await context.close();
    }
});
test('Blinkit missing checkout state reports its cause instead of a second pay-button timeout', async () => {
    const { platform, context } = await fixture('missing');
    try {
        const start = performance.now();
        await assert.rejects(platform.getOrderPreview(), /did not offer Proceed/);
        assert.ok(performance.now() - start < 11000);
    }
    finally {
        await context.close();
    }
});
//# sourceMappingURL=blinkit-checkout.test.js.map