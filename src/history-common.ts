import type { HistoryQuery, HistoryOrder, OrderHistory, HistoryCard, HistoryPlatform } from './order-history.js';

export interface DatedHistoryCard extends HistoryCard {
  date: string; placedAt: string; orderNumber?: string; quantityCount: number; expectedTotal?: number; refundTotal?: number;
}
export interface HistoryBatch { cards: DatedHistoryCard[]; hasMore: boolean }
export interface HistorySource {
  first(): Promise<HistoryBatch>;
  next(): Promise<HistoryBatch>;
  read(card: DatedHistoryCard): Promise<HistoryOrder>;
  newestFirst: boolean;
}
export const historyRound = (n: number) => Math.round(n * 100) / 100;
export function historyMoney(value: unknown, paise = false): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' ||
      (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) || !Number.isFinite(Number(value)))
    throw new Error('Historical money amount is missing or invalid.');
  return historyRound(Number(value) / (paise ? 100 : 1));
}
export function historyDate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Historical purchase date is missing.');
  const calendarDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate) || !Number.isFinite(Date.parse(calendarDate)) ||
      new Date(calendarDate).toISOString().slice(0, 10) !== calendarDate)
    throw new Error('Historical purchase date is invalid.');
  let date: string;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) date = value.slice(0, 10); // BigBasket local time
  else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
    date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  else throw new Error('Historical purchase date must include a year and a known timezone.');
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('Historical purchase date is invalid.');
  return date;
}
export function reconcileHistory(order: HistoryOrder, expectedQuantity: number): HistoryOrder {
  if (!order.items.length || !Number.isInteger(expectedQuantity) || expectedQuantity < 1 ||
      order.items.reduce((s, i) => s + i.quantity, 0) !== expectedQuantity)
    throw new Error('Historical item quantities are incomplete.');
  for (const i of order.items) {
    if (!i.name || !i.packSize || !Number.isInteger(i.quantity) || i.quantity < 1 ||
        !Number.isFinite(i.lineTotal) || i.lineTotal < 0 || !Number.isFinite(i.unitPrice))
      throw new Error('Historical item fields are incomplete.');
  }
  if (Math.abs(historyRound(order.items.reduce((s, i) => s + i.lineTotal, 0)) - order.itemSubtotal) > 0.01 ||
      Math.abs(historyRound(order.itemSubtotal + order.fees.reduce((s, f) => s + f.amount, 0)) - order.total) > 0.01)
    throw new Error('Historical item amounts or bill components do not reconcile.');
  return order;
}

/** Only complete exhaustion or a proven newest-first date boundary establishes completeness. */
export async function scanHistory(platform: HistoryPlatform, query: HistoryQuery, source: HistorySource): Promise<OrderHistory> {
  const result: OrderHistory = { platform, startDate: query.startDate, endDate: query.endDate, currency: 'INR',
    orders: [], complete: false, warnings: [], information: 'Historical bill values include cancelled/refunded orders with their status. Do not count them as spending. Applied credits and refunds are separate when available.' };
  let batch = await source.first(), previous = '9999-12-31', ordered = source.newestFirst;
  const seen = new Set<string>();
  for (let index = 0; index < 50; index++) {
    let added = 0;
    for (const card of batch.cards) {
      if (seen.has(card.id)) continue;
      if (seen.size >= query.maxOrders) {
        result.warnings.push('Order inspection limit reached; increase max_orders or narrow the date range.');
        return result;
      }
      seen.add(card.id); added++;
      if (card.date > previous) ordered = false;
      previous = card.date;
      if (card.date < query.startDate || card.date > query.endDate) continue;
      try { result.orders.push(await source.read(card)); }
      catch { result.warnings.push(`Could not read or reconcile order ${card.id}; results are incomplete.`); }
    }
    if (!batch.hasMore || (ordered && previous < query.startDate)) {
      result.complete = !result.warnings.length;
      return result;
    }
    if (seen.size >= query.maxOrders) {
      result.warnings.push('Order inspection limit reached; increase max_orders or narrow the date range.');
      return result;
    }
    if (!added) { result.warnings.push('History pagination repeated orders without progress.'); return result; }
    try { batch = await source.next(); }
    catch { result.warnings.push('Could not load the next history page; results are incomplete.'); return result; }
  }
  result.warnings.push('History page limit reached; results are incomplete.');
  return result;
}
