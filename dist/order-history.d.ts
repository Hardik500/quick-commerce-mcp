/** Read-only purchase history. Only allowlisted order/item fields leave the adapter. */
export declare const HISTORY_PLATFORMS: readonly ["blinkit", "zepto", "bigbasket"];
export type HistoryPlatform = typeof HISTORY_PLATFORMS[number];
export interface HistoryQuery {
    startDate: string;
    endDate: string;
    maxOrders: number;
}
export interface HistoryItem {
    name: string;
    packSize: string;
    quantity: number;
    /** Historical line amount for all units; cancelled/refunded status remains separate. Never the crossed-out MRP. */
    lineTotal: number;
    unitPrice: number;
    fulfilledQuantity?: number;
}
export interface HistoryOrder {
    id: string;
    orderNumber?: string;
    date: string;
    placedAt: string;
    status: string;
    items: HistoryItem[];
    itemSubtotal: number;
    total: number;
    fees: {
        label: string;
        amount: number;
    }[];
    credits?: {
        label: string;
        amount: number;
    }[];
    amountPayable?: number;
    refundTotal?: number;
}
export interface OrderHistory {
    platform: HistoryPlatform;
    startDate: string;
    endDate: string;
    currency: 'INR';
    orders: HistoryOrder[];
    complete: boolean;
    warnings: string[];
    information?: string;
}
export interface HistoryCard {
    id: string;
    url: string;
    status: string;
}
export declare function historyQuery(args: any): HistoryQuery;
export declare function historyPage(payload: unknown): {
    cards: HistoryCard[];
    hasMore: boolean;
};
export declare function historyDetail(payload: unknown, card: HistoryCard, referenceTime?: Date): HistoryOrder;
//# sourceMappingURL=order-history.d.ts.map