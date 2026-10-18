import type { Page } from 'playwright';
import type { HistoryQuery, HistoryOrder, OrderHistory } from './order-history.js';
import { type DatedHistoryCard, type HistoryBatch } from './history-common.js';
export declare function bigBasketHistoryPage(payload: any, pageNumber?: number): HistoryBatch;
export declare function bigBasketHistoryDetail(payload: any, card: DatedHistoryCard): HistoryOrder;
export declare function readBigBasketOrder(page: Page, card: DatedHistoryCard): Promise<HistoryOrder>;
export declare function bigBasketOrderHistory(page: Page, query: HistoryQuery): Promise<OrderHistory>;
//# sourceMappingURL=bigbasket-history.d.ts.map