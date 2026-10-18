/** Read-only purchase history. Only allowlisted order/item fields leave the adapter. */
export interface HistoryQuery {
    startDate: string;
    endDate: string;
    maxOrders: number;
}
export interface HistoryItem {
    name: string;
    packSize: string;
    quantity: number;
    /** Historical charged line amount, including all units; never the crossed-out MRP. */
    lineTotal: number;
    unitPrice: number;
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
}
export interface OrderHistory {
    platform: 'blinkit';
    startDate: string;
    endDate: string;
    currency: 'INR';
    orders: HistoryOrder[];
    complete: boolean;
    warnings: string[];
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
export declare function historyDetail(payload: unknown, card: HistoryCard): HistoryOrder;
//# sourceMappingURL=order-history.d.ts.map