/** Read-only purchase history. Only allowlisted order/item fields leave the adapter. */
export interface HistoryQuery { startDate: string; endDate: string; maxOrders: number }
export interface HistoryItem {
  name: string; packSize: string; quantity: number;
  /** Historical charged line amount, including all units; never the crossed-out MRP. */
  lineTotal: number;
  unitPrice: number;
}
export interface HistoryOrder {
  id: string; orderNumber?: string; date: string; placedAt: string; status: string;
  items: HistoryItem[]; itemSubtotal: number; total: number;
  fees: { label: string; amount: number }[];
}
export interface OrderHistory {
  platform: 'blinkit'; startDate: string; endDate: string; currency: 'INR';
  orders: HistoryOrder[]; complete: boolean; warnings: string[];
}
export interface HistoryCard { id: string; url: string; status: string }
type Snippet = { widget_type: string; data: any; tracking?: any };

export function historyQuery(args: any): HistoryQuery {
  const validDate = (s: unknown): s is string => typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!validDate(args?.start_date) || !validDate(args?.end_date))
    throw new Error('start_date and end_date must be real dates in YYYY-MM-DD format (inclusive, Asia/Kolkata).');
  if (args.start_date > args.end_date) throw new Error('start_date must be on or before end_date.');
  const maxOrders = args.max_orders ?? 100;
  if (!Number.isInteger(maxOrders) || maxOrders < 1 || maxOrders > 200)
    throw new Error('max_orders must be an integer from 1 to 200.');
  return { startDate: args.start_date, endDate: args.end_date, maxOrders };
}

function snippets(payload: any): Snippet[] {
  if (payload?.is_success !== true || !Array.isArray(payload?.response?.snippets))
    throw new Error('Blinkit did not return authenticated order data. Check login and retry.');
  return payload.response.snippets;
}

export function historyPage(payload: unknown): { cards: HistoryCard[]; hasMore: boolean } {
  const rows = snippets(payload);
  const cards = rows.filter(s => s.widget_type === 'order_history_container_vr').map(s => {
    const link = s.data?.click_action?.blinkit_deeplink?.url;
    if (typeof link !== 'string') throw new Error('Blinkit order history layout changed: missing order link.');
    const url = new URL(link);
    const id = url.searchParams.get('order_id'), cart = url.searchParams.get('cart_id');
    const detailLink = url.hostname === 'widgetized' && url.pathname === '/order_details_v2';
    const trackingLink = url.hostname === 'track-order' && (url.pathname === '' || url.pathname === '/');
    if (url.protocol !== 'grofers:' || (!detailLink && !trackingLink) || url.username || url.password ||
        !id || !/^\d+$/.test(id) || !cart || !/^\d+$/.test(cart))
      throw new Error('Blinkit order history returned an unrecognized order link.');
    const status = s.data.items?.[0]?.tracking?.common_attributes?.order_status;
    return { id, url: `https://blinkit.com/account/orders/${cart}/${id}`,
      status: typeof status === 'string' ? status : 'unknown' };
  });
  const next = (payload as any).response.pagination?.next_url;
  if (next != null && typeof next !== 'string') throw new Error('Blinkit history pagination changed.');
  if (rows.length && !cards.length &&
      !rows.some(s => /no orders|haven.t (?:placed|ordered)|no past orders/i.test(s.data?.title?.text ?? '')))
    throw new Error('Blinkit history contained no recognizable orders or empty-history message.');
  return { cards, hasMore: !!next };
}

const round = (n: number) => Math.round(n * 100) / 100;
function amount(text: unknown): number {
  if (typeof text !== 'string') throw new Error('Missing historical price.');
  // Discounted prices follow a struck-out MRP. Exclude MRP completely, even if it is the only price.
  const current = text.replace(/~~[\s\S]*?~~/g, '');
  const amounts = [...current.matchAll(/([+-]?)₹\s*([\d,]+(?:\.\d{1,2})?)/g)];
  if (!amounts.length) {
    if (/^\s*FREE\s*$/i.test(current)) return 0;
    throw new Error('Missing historical charged price.');
  }
  const m = amounts[amounts.length - 1];
  return Number(m[2].replace(/,/g, '')) * (m[1] === '-' ? -1 : 1);
}

function placedDate(text: string, referenceTime: Date): string {
  // Recent details use "placed today/yesterday". Resolve only those explicit
  // relative labels against the response time in the account's Indian timezone.
  const relative = text.match(/^placed\s+(today|yesterday),/i);
  if (relative) {
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(referenceTime);
    return relative[1].toLowerCase() === 'today' ? localDate :
      new Date(Date.parse(localDate) - 86400000).toISOString().slice(0, 10);
  }
  const m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})['’\s]+(\d{4}|\d{2})\b/);
  const month = m ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    .findIndex(x => x.toLowerCase() === m[2].toLowerCase()) + 1 : 0;
  if (!m || !month) throw new Error('Blinkit order date is missing its year or is unrecognized.');
  const year = m[3].length === 2 ? '20' + m[3] : m[3];
  const date = `${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  historyQuery({ start_date: date, end_date: date });
  return date;
}

export function historyDetail(payload: unknown, card: HistoryCard, referenceTime = new Date()): HistoryOrder {
  const rows = snippets(payload);
  const placedAt = rows.find(s => s.data?.title?.text === 'Order placed')?.data?.subtitle2?.text;
  if (typeof placedAt !== 'string') throw new Error('Blinkit order detail did not finish loading: missing purchase date.');
  const date = placedDate(placedAt, referenceTime);
  const itemRows = rows.filter(s => s.widget_type === 'z_v3_image_text_snippet_type_30');
  const items = itemRows.map(s => {
    const { title, subtitle1, subtitle3 } = s.data;
    const quantity = subtitle1?.text?.match(/^(.*?)\s+[x×]\s*(\d+)\s*$/i);
    if (typeof title?.text !== 'string' || !title.text.trim() || !quantity || Number(quantity[2]) < 1)
      throw new Error('Blinkit historical item name or quantity is unrecognized.');
    const lineTotal = amount(subtitle3?.text);
    if (lineTotal < 0) throw new Error('Blinkit historical item has a negative price.');
    return { name: title.text.trim(), packSize: quantity[1].trim(), quantity: Number(quantity[2]),
      lineTotal, unitPrice: round(lineTotal / Number(quantity[2])) };
  });
  const countText = rows.find(s => /^\d+ items? in this order$/i.test(s.data?.title?.text ?? ''))?.data.title.text;
  if (!items.length || !countText || Number(countText.match(/^\d+/)[0]) !== items.length)
    throw new Error('Blinkit order items are incomplete or the item layout changed.');
  const bill = rows.filter(s => s.widget_type === 'cart_bill_item').map(s =>
    ({ label: String(s.data?.left_header?.text ?? ''), amount: amount(s.data?.right_header?.text) }));
  // Blinkit omits Item total and Product discount when every item sold at MRP.
  // Accept that layout only when the charged item lines reconcile with the MRP row.
  const itemSubtotal = bill.find(r => /^item total$/i.test(r.label))?.amount ??
    (!bill.some(r => /^product discount$/i.test(r.label)) ? bill.find(r => /^MRP$/i.test(r.label))?.amount : undefined);
  const total = bill.find(r => /^bill total$/i.test(r.label))?.amount;
  if (itemSubtotal === undefined || total === undefined) throw new Error('Blinkit historical bill totals are missing.');
  const sum = round(items.reduce((s, i) => s + i.lineTotal, 0));
  if (Math.abs(sum - itemSubtotal) > 0.01)
    throw new Error('Historical item prices do not reconcile with the item total; price semantics need inspection.');
  const fees = bill.filter(r => !/^(?:MRP|Product discount|Item total|Bill total)$/i.test(r.label));
  if (Math.abs(round(itemSubtotal + fees.reduce((s, f) => s + f.amount, 0)) - total) > 0.01)
    throw new Error('Historical bill components do not reconcile with the order total.');
  const orderNumber = rows.map(s => s.data?.button?.text).find(t => typeof t === 'string' && /^ORD\d+\s*$/.test(t))?.trim();
  return { id: card.id, orderNumber, date, placedAt, status: card.status, items, itemSubtotal, total, fees };
}
