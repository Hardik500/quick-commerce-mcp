import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { historyQuery } from './order-history.js';
import { historyDate, historyMoney, scanHistory } from './history-common.js';
import { zeptoHistoryPage, zeptoHistoryDetail, zeptoOrderHistory } from './zepto-history.js';
import { bigBasketHistoryPage, bigBasketHistoryDetail, bigBasketOrderHistory } from './bigbasket-history.js';

const query = () => historyQuery({ start_date: '2026-10-01', end_date: '2026-10-31' });
function zList(ids = ['z1'], endOfList = true) {
  return { orders: ids.map(id => ({ id, code: 'Z-' + id, status: 'DELIVERED', placedTime: '2026-10-18T20:00:00Z',
    itemQuantityCount: 2, grandTotalAmount: 4200, totalRefundAmount: 0, isArchived: false,
    customer: 'PRIVATE_PROFILE_CANARY' })), endOfList };
}
const zCard = (id = 'z1') => zeptoHistoryPage(zList([id])).cards[0];
const text = (text: string, variant = 'body4') => ({ type: 'TEXT', text, variant });
function zPages(id = 'z1', complete = true) {
  return [
    { endOfPage: false, pageLayout: { widgets: [{ widgetId: 1, widgetType: 'SHIPMENT_DETAILS', data: { items: [
      { orderId: id, parentOrderId: id, orderProductsV2: { sectionData: [{ orderProducts: [
        { quantityOrdered: 2, quantityFulfilled: 2, totalFinalSellingPrice: 4000, unitFinalSellingPrice: 2000,
          storeProduct: { product: { name: 'Fixture Soda' }, productVariant: { formattedPacksize: '1 pc (300 ml)' } } },
      ] }] } },
    ] } }] } },
    { endOfPage: complete, pageLayout: { widgets: [{ widgetId: 2, widgetType: 'BILL_INFO', data: { items: [
      { feeId: 'itemTotal', leftStructureInfos: [text('Item Total')], rightStructureInfos: [text('₹99', 'strikethrough3'), text('₹40')] },
      { feeSection: 'feesAndGst', leftStructureInfos: [text('Handling Fee')], rightStructureInfos: [text('₹20', 'strikethrough3'), text('FREE')] },
      { feeSection: 'feesAndGst', leftStructureInfos: [text('Delivery Fee')], rightStructureInfos: [text('₹2')] },
      { feeSection: 'toPay', leftStructureInfos: [text('Total Bill')], rightStructureInfos: [text('₹141', 'strikethrough3'), text('₹42')] },
    ] } }, { widgetId: 3, widgetType: 'ORDER_INFO', data: { member: 'PRIVATE_ADDRESS_CANARY', payment: 'PRIVATE_PAYMENT_CANARY' } }] } },
  ];
}
function bbDetail(id = '100') {
  return { order: { order_id: id, order_number: 'BB-' + id, status: 'cancelled', created_on: '2026-10-04 12:00:00',
    items_count: 2, sub_total: 40.5, total_with_charges: 45.5, total_payable_with_charges: 43.94,
    delivery_charge: 0, contactless_delivery_charge: 0, final_voucher_amount: '3.00', wallet_used: '0.56', neucoins_used: '1.00',
    member: { address: 'PRIVATE_ADDRESS_CANARY', phone: 'PRIVATE_PHONE_CANARY' }, payment_method: 'PRIVATE_PAYMENT_CANARY',
    charges: [
      { charge: 8, calculated_charge: 8, description: { display_name: 'Handling Charge' } },
      { charge: 0, calculated_charge: 15, waive_off_applied: true, description: { display_name: 'Delivery Charge' } },
    ],
    items: [{ line_items: [
      { brand: 'Fixture', desc: 'Milk', weight: '500 ml', quantity: 2, actual_quantity: 0, sp: 10, total: 20 },
      { brand: 'Fixture', desc: 'Rice', weight: '1 kg', quantity: 1, actual_quantity: 0, sp: 20.5, total: 20.5 },
    ] }],
  }, refund_details: { total_amount_refunded: 3 } };
}
function bbList(ids = ['100'], totalPages = 1) {
  return { total_pages: String(totalPages), recent_delivered_total_pages: 0, past_total_pages: totalPages,
    orders: [{ orders: ids.map(id => { const o = bbDetail(id).order; return { order_id: id, order_number: o.order_number,
      created_on: o.created_on, status: o.status, items_count: o.items_count }; }) }] };
}
const bbCard = (id = '100') => bigBasketHistoryPage(bbList([id])).cards[0];

test('historical currency units and Indian purchase dates are explicit', () => {
  assert.equal(historyMoney(4200, true), 42);
  assert.equal(historyMoney(42), 42);
  assert.equal(historyDate('2026-10-18T20:00:00Z'), '2026-10-19');
  assert.equal(historyDate('2026-10-04 12:00:00'), '2026-10-04');
  for (const value of [null, undefined, '', 'not money']) assert.throws(() => historyMoney(value));
  assert.throws(() => historyDate('Oct 4'));
  assert.throws(() => historyDate('2026-02-30T12:00:00Z'));
  assert.throws(() => historyDate('2026-02-30 12:00:00'));
});

test('Zepto merges both detail responses, excludes MRP/waived fees, and keeps quantity distinct from pack size', () => {
  const result = zeptoHistoryDetail(zPages(), zCard());
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].unitPrice, 20);
  assert.equal(result.items[0].lineTotal, 40);
  assert.equal(result.total, 42);
  assert.equal(result.date, '2026-10-19');
  assert.equal(result.fees[0].amount, 0);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('Zepto refuses incomplete pagination, wrong identities and mismatched line quantities or bills', () => {
  assert.throws(() => zeptoHistoryDetail(zPages('z1', false), zCard()));
  assert.throws(() => zeptoHistoryDetail(zPages('z2'), zCard()));
  assert.throws(() => zeptoHistoryDetail(zPages(), { ...zCard(), quantityCount: 3 }));
  assert.throws(() => zeptoHistoryDetail(zPages(), { ...zCard(), expectedTotal: 45 }));
  assert.throws(() => zeptoHistoryPage({ orders: [] }));
});

test('BigBasket uses rupees, separates credits from bill value and exposes cancelled status and refunds', () => {
  const result = bigBasketHistoryDetail(bbDetail(), bbCard());
  assert.equal(result.itemSubtotal, 40.5);
  assert.equal(result.total, 45.5);
  assert.equal(result.amountPayable, 43.94);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].fulfilledQuantity, 0);
  assert.equal(result.items[0].lineTotal, 20);
  assert.equal(result.items[0].unitPrice, 10);
  assert.equal(result.fees.find(f => /Delivery/.test(f.label))?.amount, 0);
  assert.equal(result.refundTotal, 3);
  assert.equal(result.status, 'cancelled');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('BigBasket refuses missing product rows, mismatched identity, unknown amounts and unreconciled credits', () => {
  const missing = bbDetail(); missing.order.items[0].line_items.pop();
  assert.throws(() => bigBasketHistoryDetail(missing, bbCard()));
  assert.throws(() => bigBasketHistoryDetail(bbDetail('101'), bbCard()));
  const wrongCredit = bbDetail(); wrongCredit.order.wallet_used = '2.00';
  assert.throws(() => bigBasketHistoryDetail(wrongCredit, bbCard()));
  const wrongPrice = bbDetail(); wrongPrice.order.items[0].line_items[0].total = 10;
  assert.throws(() => bigBasketHistoryDetail(wrongPrice, bbCard()));
  assert.throws(() => bigBasketHistoryPage({ orders: [] }));
});

test('shared scanner handles grouped out-of-order history, duplicates, failures, and inspection caps explicitly', async () => {
  const newer = bbCard('101'), older = { ...bbCard('100'), date: '2026-09-30' };
  let pages = 0;
  const result = await scanHistory('bigbasket', query(), { newestFirst: false,
    first: async () => ({ cards: [older], hasMore: true }),
    next: async () => { pages++; return { cards: [older, newer], hasMore: false }; },
    read: async c => bigBasketHistoryDetail(bbDetail(c.id), c) });
  assert.equal(pages, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.orders.map(o => o.id), ['101']);
  const incomplete = await scanHistory('bigbasket', query(), { newestFirst: false,
    first: async () => ({ cards: [newer], hasMore: false }), next: async () => { throw new Error(); }, read: async () => { throw new Error(); } });
  assert.equal(incomplete.complete, false);
  assert.match(incomplete.warnings[0], /101/);
  const capped = await scanHistory('bigbasket', { ...query(), maxOrders: 1 }, { newestFirst: false,
    first: async () => ({ cards: [newer, bbCard('102')], hasMore: false }),
    next: async () => { throw new Error(); }, read: async c => bigBasketHistoryDetail(bbDetail(c.id), c) });
  assert.equal(capped.complete, false);
  assert.match(capped.warnings[0], /limit/);
});

let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function fixture(platform: 'zepto' | 'bigbasket', incomplete = false) {
  const host = platform === 'zepto' ? 'www.zeptonow.com' : 'www.bigbasket.com';
  const listPath = platform === 'zepto' ? '/api/v2/order/' : '/self-service-svc/v2/order-listing/';
  const context = await browser.newContext();
  const requests: string[] = [];
  await context.route('https://' + host + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push(request.method() + ' ' + url.pathname);
    if (url.pathname === listPath) {
      const batch = Number(url.searchParams.get('page') ?? 0);
      return route.fulfill({ json: platform === 'zepto'
        ? zList(batch ? ['z1', 'z2'] : ['z1'], !!batch)
        : bbList(batch ? ['100', '101'] : ['100'], 2) });
    }
    if (url.pathname === '/pfs-postorder/api/v1/get-page/ORDER_DETAILS') {
      const args = JSON.parse(request.postData()!);
      return route.fulfill({ json: zPages(args.id, !incomplete)[args.page] });
    }
    if (/^\/order\/v2\/order\/\d+\/detail$/.test(url.pathname)) {
      return route.fulfill({ json: bbDetail(url.pathname.split('/')[4]) });
    }
    const id = platform === 'zepto' ? url.pathname.match(/^\/order\/([\w-]+)/)?.[1]
      : url.pathname.match(/^\/member\/order-details\/(\d+)\//)?.[1];
    const script = id ? platform === 'zepto'
      ? `async function load(){for(let page=0;page<2;page++)await fetch('/pfs-postorder/api/v1/get-page/ORDER_DETAILS',{method:'POST',body:JSON.stringify({id:${JSON.stringify(id)},page})});document.body.insertAdjacentHTML('beforeend','<div>Total Bill</div>')}load();`
      : `fetch('/order/v2/order/${id}/detail')`
      : `fetch('${listPath}');let page=0;function next(){page++;fetch('${listPath}?page='+page)}`;
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><body><button onclick="next()">${platform === 'zepto' ? 'Load More' : 'Next'}</button><script>${script}</script>` });
  });
  const page = await context.newPage();
  return { context, page, requests };
}

for (const platform of ['zepto', 'bigbasket'] as const) {
  test(platform + ': browser-generated paginated history returns historical products without mutation controls', async () => {
    const f = await fixture(platform);
    try {
      const result = await (platform === 'zepto' ? zeptoOrderHistory : bigBasketOrderHistory)(f.page, query());
      assert.equal(result.complete, true);
      assert.equal(result.orders.length, 2);
      assert.equal(f.context.pages().length, 1, 'temporary detail page is closed');
      assert.ok(f.requests.every(r => !/cart|checkout|reorder|cancel|payment/.test(r)));
      assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    } finally { await f.context.close(); }
  });
}

test('Zepto cannot report complete items when the bill renders before all detail pages are available', async () => {
  const f = await fixture('zepto', true);
  try {
    const result = await zeptoOrderHistory(f.page, query());
    assert.equal(result.complete, false);
    assert.equal(result.orders.length, 0);
    assert.ok(result.warnings.length > 0);
  } finally { await f.context.close(); }
});
