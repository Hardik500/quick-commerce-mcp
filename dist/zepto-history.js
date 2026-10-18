import { historyDate, historyMoney, historyRound, reconcileHistory, scanHistory } from './history-common.js';
const origin = 'https://www.zeptonow.com';
const listPath = '/api/v2/order/';
const detailPath = '/pfs-postorder/api/v1/get-page/ORDER_DETAILS';
export function zeptoHistoryPage(payload) {
    if (!Array.isArray(payload?.orders) || typeof payload.endOfList !== 'boolean')
        throw new Error('Zepto did not return authenticated order history.');
    return { hasMore: !payload.endOfList, cards: payload.orders.map((o) => {
            if (typeof o.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(o.id) || typeof o.status !== 'string' || typeof o.code !== 'string' ||
                !Number.isInteger(o.itemQuantityCount) || o.itemQuantityCount < 1)
                throw new Error('Zepto order history layout changed.');
            return { id: o.id, url: `${origin}/order/${o.id}?isArchived=${o.isArchived === true}`,
                status: o.status, date: historyDate(o.placedTime), placedAt: o.placedTime, orderNumber: o.code,
                quantityCount: o.itemQuantityCount, expectedTotal: historyMoney(o.grandTotalAmount, true),
                refundTotal: historyMoney(o.totalRefundAmount ?? 0, true) };
        }) };
}
function billText(nodes) {
    if (!Array.isArray(nodes))
        throw new Error('Zepto historical bill layout changed.');
    return nodes.filter(n => !/strikethrough/i.test(n.variant ?? '')).map(n => n.text ?? '').join(' ').trim();
}
export function zeptoHistoryDetail(pages, card) {
    if (!pages.length || !pages.some(p => p.endOfPage === true))
        throw new Error('Zepto detail pagination is incomplete.');
    const widgets = new Map();
    for (const p of pages) {
        if (!Array.isArray(p?.pageLayout?.widgets))
            throw new Error('Zepto order detail layout changed.');
        for (const w of p.pageLayout.widgets)
            widgets.set(w.widgetId, w);
    }
    const shipments = [...widgets.values()].filter(w => w.widgetType === 'SHIPMENT_DETAILS').flatMap(w => w.data?.items ?? []);
    if (!shipments.length || shipments.some(s => s.parentOrderId !== card.id && s.orderId !== card.id))
        throw new Error('Zepto order detail identity does not match the requested order.');
    const products = shipments.flatMap(s => s.orderProductsV2?.sectionData?.flatMap((g) => g.orderProducts ?? []) ?? []);
    const items = products.map((p) => {
        const quantity = p.quantityOrdered;
        const lineTotal = historyMoney(p.totalFinalSellingPrice, true);
        return { name: p.storeProduct?.product?.name, packSize: p.storeProduct?.productVariant?.formattedPacksize,
            quantity, lineTotal, unitPrice: historyRound(lineTotal / quantity) };
    });
    const billWidgets = [...widgets.values()].filter(w => w.widgetType === 'BILL_INFO');
    if (billWidgets.length !== 1)
        throw new Error('Zepto historical bill is missing or ambiguous.');
    const bill = billWidgets[0].data.items.filter((r) => Array.isArray(r.rightStructureInfos)).map((r) => {
        const text = billText(r.rightStructureInfos), label = billText(r.leftStructureInfos);
        const match = text.match(/^([+-]?)₹\s*([\d,]+(?:\.\d+)?)$/);
        const amount = /^FREE$/i.test(text) ? 0 : match ? historyMoney(match[2].replace(/,/g, '')) * (match[1] === '-' ? -1 : 1) : undefined;
        if (amount === undefined)
            throw new Error('Zepto historical charged bill amount is unrecognized.');
        return { label, amount, section: r.feeSection, id: r.feeId };
    });
    const itemSubtotal = bill.find((r) => r.id === 'itemTotal')?.amount;
    const total = bill.find((r) => r.section === 'toPay')?.amount;
    if (itemSubtotal === undefined || total === undefined || Math.abs(total - card.expectedTotal) > 0.01)
        throw new Error('Zepto historical bill does not match its order summary.');
    return reconcileHistory({ id: card.id, orderNumber: card.orderNumber, date: card.date, placedAt: card.placedAt,
        status: card.status, items, itemSubtotal, total, refundTotal: card.refundTotal,
        fees: bill.filter((r) => r.id !== 'itemTotal' && r.section !== 'toPay').map(({ label, amount }) => ({ label, amount })) }, card.quantityCount);
}
async function openList(page) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === listPath, { timeout: 15000 }).catch(() => null);
    await page.goto(origin + '/account/orders', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let received = await response;
    if (!received) {
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('[aria-label="profile"], [data-testid="profile"]').first().click({ timeout: 8000 });
        const ready = page.waitForResponse(r => new URL(r.url()).pathname === listPath, { timeout: 15000 });
        const [, response] = await Promise.all([page.getByText(/^orders$/i).first().click({ timeout: 8000 }), ready]);
        received = response;
    }
    if (!received.ok())
        throw new Error('Zepto order history unavailable; check login.');
    return zeptoHistoryPage(await received.json());
}
export async function readZeptoOrder(page, card) {
    const pages = [], pending = [];
    const onResponse = (r) => {
        if (new URL(r.url()).pathname !== detailPath)
            return;
        pending.push((async () => {
            if (!r.ok())
                throw new Error('Zepto order detail unavailable.');
            pages.push(await r.json());
        })());
        // Attach a rejection handler immediately; all failures are checked below.
        void pending[pending.length - 1].catch(() => { });
    };
    page.on('response', onResponse);
    try {
        await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // The item and bill are separate browser-generated page responses.
        await page.getByText('Total Bill', { exact: true }).waitFor({ timeout: 20000 });
        await Promise.all(pending);
        return zeptoHistoryDetail(pages, card);
    }
    finally {
        page.off('response', onResponse);
    }
}
export async function zeptoOrderHistory(page, query) {
    const details = await page.context().newPage();
    try {
        return await scanHistory('zepto', query, {
            newestFirst: true, first: () => openList(page),
            next: async () => {
                const ready = page.waitForResponse(r => new URL(r.url()).pathname === listPath, { timeout: 10000 });
                const [, response] = await Promise.all([page.getByRole('button', { name: 'Load More', exact: true }).click({ timeout: 6000 }), ready]);
                if (!response.ok())
                    throw new Error('Zepto history pagination failed.');
                return zeptoHistoryPage(await response.json());
            },
            read: card => readZeptoOrder(details, card),
        });
    }
    finally {
        await details.close();
    }
}
//# sourceMappingURL=zepto-history.js.map