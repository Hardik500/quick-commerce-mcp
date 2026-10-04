import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BigBasketPlatform } from './platforms/bigbasket.js';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(reject = false, unavailable = false, initialCount = 0, autocomplete = false) {
    const context = await browser.newContext();
    let count = initialCount;
    let clicks = 0;
    let listingVisits = 0;
    await context.route('https://www.bigbasket.com/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/ps/')
            listingVisits++;
        if (url.pathname === '/listing-svc/v1/product/term-completion')
            return route.fulfill({ status: autocomplete ? 200 : 503, json: { ok: autocomplete } });
        if (url.pathname === '/co/checkout/')
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div><span>Delivery Address</span><p>Home - Fixture address</p></div><div>Payment Options</div><iframe name="HyperServices" srcdoc="<div role='tab'>UPI</div><div role='tab'>Pay on delivery</div>"></iframe><div><span>Basket Value</span><span>₹30</span></div><div><span>Delivery &amp; Handling Charges</span><del>₹23</del><span>₹8</span></div><div><span>Total Amount Payable</span><span>₹37.44</span></div>` });
        if (url.pathname === '/write') {
            clicks++;
            if (!reject)
                count = Number(route.request().postData());
            return route.fulfill({ status: reject ? 400 : 200, json: { ok: !reject } });
        }
        const row = `<li class="BasketItem___StyledLi-test"><img src="https://example.com/p/l/123_2-test.jpg"><div class="BasketDescription___StyledDiv-test">Gold Glucose Biscuits</div>₹30<button id="increment" onclick="changeBasket()">+</button></li>`;
        const basket = count ? row.replace('<button id="increment"', `<div>${count}</div><button id="increment"`) : "<div>Let's fill the empty</div>";
        const card = `<div class="SKUDeck___StyledDiv-test"><img src="https://example.com/p/l/123_2-test.jpg"><a href="/pd/123/biscuits/"><span class="BrandName___StyledLabel-test">Parle-G</span><div><h3>Gold Glucose Biscuits</h3></div></a><h3><button>1 kg</button></h3>₹30 ₹40<div><span>${count || ""}</span><button onclick="change()"><svg><path d="M19 11H13V5"></path></svg></button></div><button onclick="change()">Add</button></div>`;
        const suggestion = '<li><a href="/pd/123/biscuits/?nc=as">Parle-G Gold Glucose Biscuits</a><span>1 kg</span>₹30<button onclick="change()">Add</button></li>';
        const search = url.pathname !== '/basket/' ? '<input placeholder="Search for Products..."><input placeholder="Search for Products..." oninput="fetch(\'/listing-svc/v1/product/term-completion\').then(r=>{if(r.ok)document.querySelector(\'#suggestions\').innerHTML=window.suggestionHTML})"><ul id="suggestions"></ul>' : '';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<body><a href="/basket/">Basket</a><button>Home: Fixture address</button>${search}${url.pathname === '/basket/' ? basket : card}<button onclick="${unavailable ? "document.querySelector('#preview').textContent='Confirm will remove the unavailable items from your basket.'" : "location.href='/co/checkout/'"}">Proceed to Checkout</button><div id="preview"></div><script>
      window.suggestionHTML=${JSON.stringify(suggestion)};
      let n=${count}; function change(){n++;const plus=document.querySelector('path').closest('button');let value=plus.previousElementSibling;if(!value){value=document.createElement('span');plus.before(value);}value.textContent=n;fetch('/write',{method:'POST',body:String(n)});}
      function changeBasket(){n++;document.querySelector('#increment').previousElementSibling.textContent=n;fetch('/write',{method:'POST',body:String(n)});}
      </script></body>` });
    });
    const platform = new BigBasketPlatform();
    await platform.initialize(context);
    return { platform, context, clicks: () => clicks, listingVisits: () => listingVisits };
}
test('native autocomplete searches and adds a new SKU after cart navigation without full listing or detail pages', async () => {
    const f = await fixture(false, false, 0, true);
    try {
        const result = await f.platform.search('biscuits');
        assert.equal(result.products.length, 1);
        assert.equal(result.products[0].price, 30);
        assert.match(result.information, /limited results/);
        await f.platform.getCart();
        assert.equal(await f.platform.addToCart('123', 2), 'added');
        assert.equal((await f.platform.getCart())?.items[0].cartQuantity, 2);
        assert.equal(await f.platform.addToCart('123', 2), 'already');
        assert.equal(f.clicks(), 2);
        assert.equal(f.listingVisits(), 0);
    }
    finally {
        await f.context.close();
    }
});
test('autocomplete optimistic Add never retries when basket rejects the write', async () => {
    const f = await fixture(true, false, 0, true);
    try {
        await f.platform.search('biscuits');
        assert.equal(await f.platform.addToCart('123', 1), 'failed');
        assert.match(f.platform.lastAddBlocker, /No second Add/);
        assert.equal(f.clicks(), 1);
        assert.equal(f.listingVisits(), 0);
        assert.equal((await f.platform.getCart())?.items.length, 0);
    }
    finally {
        await f.context.close();
    }
});
test('BigBasket ID-only add restores search, proves quantity in basket, and repeat is idempotent', async () => {
    const f = await fixture();
    try {
        const search = await f.platform.search('biscuits');
        assert.equal(search.products[0].id, '123');
        await f.platform.getCart();
        assert.equal(await f.platform.addToCart('123', 2), 'added');
        assert.equal((await f.platform.getCart())?.items[0].cartQuantity, 2);
        assert.equal(await f.platform.addToCart('123', 2), 'already');
        assert.equal(f.clicks(), 2);
    }
    finally {
        await f.context.close();
    }
});
test('restored basket IDs increment without search cache and persist before success', async () => {
    const f = await fixture(false, false, 1);
    try {
        assert.equal(await f.platform.addToCart('123', 2), 'added');
        assert.equal((await f.platform.getCart())?.items[0].cartQuantity, 2);
        assert.equal(await f.platform.addToCart('123', 2), 'already');
        assert.equal(f.clicks(), 1);
    }
    finally {
        await f.context.close();
    }
});
test('restored basket increment rejects an optimistic counter when persistence fails', async () => {
    const f = await fixture(true, false, 1);
    try {
        assert.equal(await f.platform.addToCart('123', 2), 'failed');
        assert.equal(f.clicks(), 1);
        assert.equal((await f.platform.getCart())?.items[0].cartQuantity, 1);
    }
    finally {
        await f.context.close();
    }
});
test('checkout login remains authenticated and nested delivery address is returned', async () => {
    const f = await fixture(false, false, 1);
    try {
        const preview = await f.platform.getOrderPreview();
        assert.match(preview.address, /Fixture address/);
        assert.equal((await f.platform.checkLogin()).loggedIn, true);
    }
    finally {
        await f.context.close();
    }
});
test('BigBasket rejects optimistic counter success when server basket rejects the write', async () => {
    const f = await fixture(true);
    try {
        await f.platform.search('biscuits');
        assert.equal(await f.platform.addToCart('123', 1), 'failed');
        assert.match(f.platform.lastAddBlocker ?? '', /basket did not confirm/);
        assert.equal((await f.platform.getCart())?.items.length, 0);
    }
    finally {
        await f.context.close();
    }
});
test('BigBasket preview refuses automatic removal of unavailable preexisting items', async () => {
    const f = await fixture(false, true);
    try {
        await f.platform.search('biscuits');
        assert.equal(await f.platform.addToCart('123', 1), 'added');
        await assert.rejects(f.platform.getOrderPreview(), /Ask the user/);
        assert.equal((await f.platform.placeOrder()).success, false);
    }
    finally {
        await f.context.close();
    }
});
test('BigBasket preview reads Juspay iframe options and payable total including discounts', async () => {
    const f = await fixture();
    try {
        await f.platform.search('biscuits');
        assert.equal(await f.platform.addToCart('123', 1), 'added');
        const preview = await f.platform.getOrderPreview();
        assert.equal(preview?.cart.total, 37.44);
        assert.equal(preview?.cart.deliveryFee, 8);
        assert.deepEqual(preview?.paymentMethods, ['UPI', 'Pay on delivery']);
        assert.match(preview?.address ?? '', /Fixture address/);
    }
    finally {
        await f.context.close();
    }
});
//# sourceMappingURL=bigbasket-flows.test.js.map