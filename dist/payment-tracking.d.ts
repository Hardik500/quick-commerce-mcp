import type { Page } from 'playwright';
export interface PaymentObservation {
    status: 'confirmed' | 'failed' | 'cancelled' | 'pending' | 'unknown';
    orderId?: string;
    paymentStatus: 'paid' | 'failed' | 'pending' | 'unknown';
    message: string;
}
export declare function orderIdentity(url: string, text: string): string | undefined;
export declare function classifyOrder(text: string): Omit<PaymentObservation, 'orderId'>;
export declare class PaymentTracker {
    private path;
    private guardPath?;
    constructor(path: string, guardPath?: string | undefined);
    private save;
    private read;
    begin(platform: string, method: string, total: number, pages: Page[]): Promise<void>;
    abandonUnsubmitted(): void;
    inspect(pages: Page[] | (() => Page[]), waitMs?: number): Promise<PaymentObservation>;
    private reconcileGuard;
}
//# sourceMappingURL=payment-tracking.d.ts.map