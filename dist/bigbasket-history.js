import { historyDate, historyMoney, historyRound, reconcileHistory, scanHistory } from './history-common.js';
const origin = 'https://www.bigbasket.com';
const listPath = '/self-service-svc/v2/order-listing/';
export function bigBasketHistoryPage(payload, pageNumber = 1) {
    if (!Array.isArray(payload?.orders))
        throw new Error('BigBasket did not return authenticated order history.');
    const counts = [payload.total_pages, payload.past_total_pages, payload.recent_delivered_total_pages]
        .filter(v => v !== undefined).map(v => Number(v));
    if (!counts.length || counts.some(v => !Number.isInteger(v) || v < 0))
        throw new Error('BigBasket history pagination metadata is missing or invalid.');
    const cards = payload.orders.flatMap((group) => {
        if (!Array.isArray(group.orders))
            throw new Error('BigBasket grouped order history changed.');
        return group.orders.map((o) => {
            if (typeof o.order_id !== 'string' || !/^\d+$/.test(o.order_id) || typeof o.status !== 'string' || typeof o.order_number !== 'string' ||
                !Number.isInteger(o.items_count) || o.items_count < 1)
                throw new Error('BigBasket history order fields are incomplete.');
            return { id: o.order_id, url: `${origin}/member/order-details/${o.order_id}/`, status: o.status,
                date: historyDate(o.created_on), placedAt: o.created_on, orderNumber: o.order_number,
                quantityCount: o.items_count };
        });
    });
    return { cards, hasMore: Math.max(...counts) > pageNumber };
}
export function bigBasketHistoryDetail(payload, card) {
    const o = payload?.order;
    if (o?.order_id !== card.id || !Array.isArray(o.items) || !Array.isArray(o.charges) ||
        historyDate(o.created_on) !== card.date)
        throw new Error('BigBasket order detail is incomplete or belongs to another order.');
    const rows = o.items.flatMap((group) => {
        if (!Array.isArray(group.line_items))
            throw new Error('BigBasket product groups are incomplete.');
        return group.line_items;
    });
    if (rows.length !== o.items_count || rows.length !== card.quantityCount)
        throw new Error('BigBasket historical product rows are incomplete.');
    const items = rows.map((r) => {
        if (typeof r.desc !== 'string' || typeof r.brand !== 'string' || !Number.isInteger(r.quantity) || r.quantity < 1)
            throw new Error('BigBasket historical product name or quantity changed.');
        const lineTotal = historyMoney(r.total), unitPrice = historyMoney(r.sp);
        if (Math.abs(historyRound(unitPrice * r.quantity) - lineTotal) > 0.01)
            throw new Error('BigBasket historical line and unit prices do not reconcile.');
        return { name: `${r.brand} ${r.desc}`.trim(), packSize: r.weight, quantity: r.quantity, lineTotal, unitPrice,
            ...(Number.isInteger(r.actual_quantity) ? { fulfilledQuantity: r.actual_quantity } : {}) };
    });
    const fees = o.charges.map((c) => {
        const label = c.description?.display_name;
        if (typeof label !== 'string' || !label.trim())
            throw new Error('BigBasket historical charge label is missing.');
        return { label, amount: historyMoney(c.charge) }; // charged amount; calculated_charge may have been waived
    });
    if (!fees.some(f => /delivery/i.test(f.label)) && historyMoney(o.delivery_charge) !== 0)
        fees.push({ label: 'Delivery charge', amount: historyMoney(o.delivery_charge) });
    if (!fees.some(f => /contactless/i.test(f.label)) && historyMoney(o.contactless_delivery_charge ?? 0) !== 0)
        fees.push({ label: 'Contactless delivery charge', amount: historyMoney(o.contactless_delivery_charge) });
    const voucher = historyMoney(o.final_voucher_amount);
    if (voucher)
        fees.push({ label: 'Voucher discount', amount: -voucher });
    const credits = [{ label: 'Wallet credit', amount: historyMoney(o.wallet_used) },
        { label: 'NeuCoins credit', amount: historyMoney(o.neucoins_used) }].filter(c => c.amount !== 0);
    const total = historyMoney(o.total_with_charges), amountPayable = historyMoney(o.total_payable_with_charges);
    if (Math.abs(historyRound(total - credits.reduce((s, c) => s + c.amount, 0)) - amountPayable) > 0.01)
        throw new Error('BigBasket historical total and applied credits do not reconcile.');
    return reconcileHistory({ id: card.id, orderNumber: card.orderNumber, date: card.date, placedAt: card.placedAt,
        status: o.status, items, itemSubtotal: historyMoney(o.sub_total), total, fees, credits, amountPayable,
        refundTotal: historyMoney(payload.refund_details?.total_amount_refunded ?? 0) }, items.reduce((s, i) => s + i.quantity, 0));
}
async function openList(page) {
    const ready = page.waitForResponse(r => new URL(r.url()).pathname === listPath, { timeout: 20000 });
    const [response] = await Promise.all([ready, page.goto(origin + '/member/active-orders/', { waitUntil: 'domcontentloaded', timeout: 30000 })]);
    if (!response.ok())
        throw new Error('BigBasket history unavailable. Check the dedicated browser session.');
    return bigBasketHistoryPage(await response.json());
}
export async function readBigBasketOrder(page, card) {
    const ready = page.waitForResponse(r => new URL(r.url()).pathname === `/order/v2/order/${card.id}/detail`, { timeout: 20000 });
    const [response] = await Promise.all([ready, page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 30000 })]);
    if (!response.ok())
        throw new Error('BigBasket order detail unavailable.');
    return bigBasketHistoryDetail(await response.json(), card);
}
export async function bigBasketOrderHistory(page, query) {
    const details = await page.context().newPage();
    let pageNumber = 1;
    try {
        return await scanHistory('bigbasket', query, {
            // Active/recent/past orders are grouped; an older row never proves the end of the range.
            newestFirst: false, first: () => openList(page),
            next: async () => {
                const next = page.getByRole('button', { name: /^(?:next(?: page)?|load more(?: orders)?)$/i })
                    .or(page.getByRole('link', { name: /^(?:next(?: page)?|load more(?: orders)?)$/i }))
                    .filter({ visible: true }).first();
                // Only read-only pagination controls; Show more on a card is not a history-page boundary.
                const ready = page.waitForResponse(r => new URL(r.url()).pathname === listPath, { timeout: 10000 });
                const [, response] = await Promise.all([next.click({ timeout: 6000 }), ready]);
                if (!response.ok())
                    throw new Error('BigBasket history pagination failed.');
                return bigBasketHistoryPage(await response.json(), ++pageNumber);
            },
            read: card => readBigBasketOrder(details, card),
        });
    }
    finally {
        await details.close();
    }
}
//# sourceMappingURL=bigbasket-history.js.map