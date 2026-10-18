import type { HistoryQuery, HistoryOrder, OrderHistory, HistoryCard, HistoryPlatform } from './order-history.js';
export interface DatedHistoryCard extends HistoryCard {
    date: string;
    placedAt: string;
    orderNumber?: string;
    quantityCount: number;
    expectedTotal?: number;
    refundTotal?: number;
}
export interface HistoryBatch {
    cards: DatedHistoryCard[];
    hasMore: boolean;
}
export interface HistorySource {
    first(): Promise<HistoryBatch>;
    next(): Promise<HistoryBatch>;
    read(card: DatedHistoryCard): Promise<HistoryOrder>;
    newestFirst: boolean;
}
export declare const historyRound: (n: number) => number;
export declare function historyMoney(value: unknown, paise?: boolean): number;
export declare function historyDate(value: unknown): string;
export declare function reconcileHistory(order: HistoryOrder, expectedQuantity: number): HistoryOrder;
/** Only complete exhaustion or a proven newest-first date boundary establishes completeness. */
export declare function scanHistory(platform: HistoryPlatform, query: HistoryQuery, source: HistorySource): Promise<OrderHistory>;
//# sourceMappingURL=history-common.d.ts.map