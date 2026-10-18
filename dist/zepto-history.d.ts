import type { Page } from 'playwright';
import type { HistoryOrder, HistoryQuery, OrderHistory } from './order-history.js';
import { type DatedHistoryCard, type HistoryBatch } from './history-common.js';
export declare function zeptoHistoryPage(payload: any): HistoryBatch;
export declare function zeptoHistoryDetail(pages: any[], card: DatedHistoryCard): HistoryOrder;
export declare function readZeptoOrder(page: Page, card: DatedHistoryCard): Promise<HistoryOrder>;
export declare function zeptoOrderHistory(page: Page, query: HistoryQuery): Promise<OrderHistory>;
//# sourceMappingURL=zepto-history.d.ts.map