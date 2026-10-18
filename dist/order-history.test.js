import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { historyQuery, historyPage, historyDetail } from './order-history.js';
import { blinkitOrderHistory, latestBlinkitOrder } from './blinkit-history.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const card = (id) => ({ id, url: `https://blinkit.com/account/orders/99/${id}`, status: 'DELIVERED' });
const payload = (rows) => ({ is_success: true, response: { snippets: rows } });
const row = (widget_type, data) => ({ widget_type, data });
const bill = (label, price) => row('cart_bill_item', { left_header: { text: label }, right_header: { text: price } });
function detail(date = "14 Oct'26", noDiscount = false) {
    return payload([
        row('v2_restaurant_card_vr_type_4', { title: { text: 'Order placed' }, subtitle2: { text: `placed on Wed, ${date}, 2:10 PM` } }),
        row('v2_image_text_snippet_type_30', { title: { text: '1 item in this order' } }),
        row('z_v3_image_text_snippet_type_30', { title: { text: 'Fixture Soda' }, subtitle1: { text: '4 x 750 ml x 2' },
            subtitle3: { text: noDiscount ? '₹100' : '~~<regular-200|{grey-600|₹160}>~~ ₹100' } }),
        bill('MRP', noDiscount ? '₹100' : '₹160'),
        ...(noDiscount ? [] : [bill('Product discount', '-₹60'), bill('Item total', '₹100')]),
        bill('Handling charge', '+₹12'), bill('Delivery charges', 'FREE'), bill('Bill total', '₹112'),
        row('v2_restaurant_card_vr_type_4', { title: { text: 'Deliver to' }, subtitle2: { text: 'PRIVATE_ADDRESS_CANARY' } }),
        row('v2_restaurant_card_vr_type_4', { title: { text: 'Payment' }, subtitle2: { text: 'PRIVATE_PAYMENT_CANARY' } }),
    ]);
}
function listing(ids, more = false) {
    const result = payload(ids.map(id => row('order_history_container_vr', {
        click_action: { blinkit_deeplink: { url: `grofers://widgetized/order_details_v2?cart_id=99&order_id=${id}` } },
        items: [{ tracking: { common_attributes: { order_status: 'DELIVERED' } } }],
    })));
    return { ...result, response: { ...result.response,
            pagination: { next_url: more ? '/v1/layout/order_history?offset=10' : '' } } };
}
const query = (start = '2026-10-01', end = '2026-10-31', max = 100) => historyQuery({ start_date: start, end_date: end, max_orders: max });
test('history validates inclusive calendar dates and limits before opening a browser', () => {
    assert.equal(query('2024-02-29', '2024-02-29').startDate, '2024-02-29');
    for (const args of [
        { start_date: '2026-02-29', end_date: '2026-03-01' },
        { start_date: '2026-10-02', end_date: '2026-10-01' },
        { start_date: 'Oct 1', end_date: '2026-10-31' },
        { start_date: '2026-10-01', end_date: '2026-10-31', max_orders: 0 },
        { start_date: '2026-10-01', end_date: '2026-10-31', max_orders: 201 },
    ])
        assert.throws(() => historyQuery(args));
});
test('historical charged lines exclude MRP, preserve pack multipliers and divide by ordered quantity', () => {
    const order = historyDetail(detail(), card('1'));
    assert.equal(order.date, '2026-10-14');
    assert.deepEqual(order.items[0], { name: 'Fixture Soda', packSize: '4 x 750 ml', quantity: 2, lineTotal: 100, unitPrice: 50 });
    assert.equal(order.itemSubtotal, 100);
    assert.equal(order.total, 112);
    assert.ok(!JSON.stringify(order).includes('PRIVATE'));
    assert.equal(historyDetail(detail('14 Oct 2025'), card('1')).date, '2025-10-14');
    assert.equal(historyDetail(detail("14 Oct'26", true), card('1')).itemSubtotal, 100);
});
test('missing rows, a lone struck-out MRP, unknown dates and unreconciled bills cannot become plausible prices', () => {
    const bad = [];
    const missing = detail();
    missing.response.snippets.splice(2, 1);
    bad.push(missing);
    const mrp = detail();
    mrp.response.snippets[2].data.subtitle3.text = '~~₹160~~';
    bad.push(mrp);
    const mismatch = detail();
    mismatch.response.snippets[2].data.subtitle3.text = '₹50';
    bad.push(mismatch);
    const total = detail();
    total.response.snippets.find(s => s.data.left_header?.text === 'Bill total').data.right_header.text = '₹999';
    bad.push(total);
    bad.push(detail('14 Oct'));
    for (const data of bad)
        assert.throws(() => historyDetail(data, card('1')));
    assert.throws(() => historyPage({ is_success: false }));
    const unrecognized = listing(['1']);
    unrecognized.response.snippets[0].data.click_action.blinkit_deeplink.url = 'https://evil.test/?order_id=1&cart_id=2';
    assert.throws(() => historyPage(unrecognized));
    assert.deepEqual(historyPage(payload([])), { cards: [], hasMore: false });
});
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });
async function fixture(batches, details) {
    const context = await browser.newContext();
    const opened = [], requests = [];
    await context.route('https://blinkit.com/**', async (route) => {
        const request = route.request(), url = new URL(request.url());
        requests.push(request.method() + ' ' + url.pathname);
        if (url.pathname === '/v1/layout/order_history') {
            const index = Number(url.searchParams.get('batch') ?? 0);
            await route.fulfill({ json: batches[index] });
        }
        else if (url.pathname.startsWith('/v1/layout/order_details/')) {
            const id = url.pathname.split('/').pop();
            opened.push(id);
            // Reproduce the old bug: shell renders before the asynchronous detail response.
            await new Promise(resolve => setTimeout(resolve, 60));
            await route.fulfill({ json: details[id] ?? { is_success: false } });
        }
        else {
            const match = url.pathname.match(/^\/account\/orders\/99\/(\d+)$/);
            const script = match
                ? `fetch('/v1/layout/order_details/${match[1]}')`
                : `fetch('/v1/layout/order_history'); let batch=0; addEventListener('scroll',()=>{ if(batch===0){batch++;fetch('/v1/layout/order_history?batch='+batch)} })`;
            await route.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="height:6000px">Account shell<script>${script}</script>` });
        }
    });
    const page = await context.newPage();
    return { page, context, opened, requests };
}
test('history follows pagination, deduplicates orders, includes both boundaries and excludes the previous year', async () => {
    const f = await fixture([listing(['1', '2'], true), listing(['2', '3', '4'])], { '1': detail("31 Oct'26"), '2': detail("15 Oct'26"), '3': detail("01 Oct'26"), '4': detail("14 Oct'25") });
    try {
        const result = await blinkitOrderHistory(f.page, query());
        assert.equal(result.complete, true);
        assert.deepEqual(result.orders.map(o => o.id), ['1', '2', '3']);
        assert.deepEqual(f.opened, ['1', '2', '3', '4']);
        assert.ok(f.requests.every(r => r.startsWith('GET ') && !/cart|payment|reorder/i.test(r)));
        assert.equal(f.context.pages().length, 1, 'temporary detail page is closed');
    }
    finally {
        await f.context.close();
    }
});
test('newer orders do not count as matches and an older purchase proves the lower boundary', async () => {
    const f = await fixture([listing(['1', '2', '3'], true)], { '1': detail("02 Nov'26"), '2': detail("01 Oct'26"), '3': detail("30 Sep'26") });
    try {
        const result = await blinkitOrderHistory(f.page, query());
        assert.equal(result.complete, true);
        assert.deepEqual(result.orders.map(o => o.id), ['2']);
    }
    finally {
        await f.context.close();
    }
});
test('unreadable details and scan caps report incomplete results instead of dropping orders silently', async () => {
    const f = await fixture([listing(['1', '2', '3'])], { '2': detail(), '3': detail("30 Sep'26") });
    try {
        const partial = await blinkitOrderHistory(f.page, query());
        assert.equal(partial.complete, false);
        assert.deepEqual(partial.orders.map(o => o.id), ['2']);
        assert.match(partial.warnings[0], /order 1/);
        const capped = await blinkitOrderHistory(f.page, query('2026-10-01', '2026-10-31', 1));
        assert.equal(capped.complete, false);
        assert.match(capped.warnings.join(' '), /limit/);
    }
    finally {
        await f.context.close();
    }
});
test('pagination with no new IDs cannot report complete history', async () => {
    const f = await fixture([listing(['1'], true), listing(['1'], true)], { '1': detail() });
    try {
        const result = await blinkitOrderHistory(f.page, query());
        assert.equal(result.complete, false);
        assert.match(result.warnings.join(' '), /without progress/);
    }
    finally {
        await f.context.close();
    }
});
test('latest order waits for detail data rather than returning the loading shell', async () => {
    const f = await fixture([listing(['1'])], { '1': detail() });
    try {
        const latest = JSON.parse((await latestBlinkitOrder(f.page)));
        assert.equal(latest.items[0].name, 'Fixture Soda');
        assert.equal(latest.total, 112);
    }
    finally {
        await f.context.close();
    }
});
test('fresh MCP advertises history and rejects unsupported platforms and invalid dates without browser work', async () => {
    const client = new Client({ name: 'history-test', version: '1' }, { capabilities: {} });
    try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], stderr: 'ignore' }));
        const tool = (await client.listTools()).tools.find(t => t.name === 'get_order_history');
        assert.ok(tool);
        assert.deepEqual(tool.inputSchema.required, ['platform', 'start_date', 'end_date']);
        for (const args of [{ platform: 'zepto', start_date: '2026-10-01', end_date: '2026-10-31' },
            { platform: 'blinkit', start_date: '2026-02-30', end_date: '2026-10-31' }]) {
            assert.equal((await client.callTool({ name: 'get_order_history', arguments: args })).isError, true);
        }
    }
    finally {
        await client.close();
    }
});
//# sourceMappingURL=order-history.test.js.map