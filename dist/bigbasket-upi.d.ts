import type { Page } from 'playwright';
import type { OrderPreview } from './platforms/base.js';
import { type WalletOrderResult } from './wallet.js';
/** Generating a merchant QR can create a pending transaction. Approval and
 * a durable shared wallet/UPI guard precede the single dispatch. */
export declare class BigBasketUpiCheckout {
    private journalPath?;
    private armed?;
    private pending;
    constructor(journalPath?: string | undefined);
    hasPending(): boolean;
    private generateControl;
    prepare(page: Page, preview: OrderPreview): Promise<WalletOrderResult>;
    submit(page: Page, preview: OrderPreview): Promise<WalletOrderResult>;
}
/** Read an already generated QR without clicking, navigating or creating a transaction. */
export declare function readBigBasketQr(page: Page, total: number): Promise<{
    image: Buffer<ArrayBuffer>;
    expiry: string;
    details: {
        amount: number;
        currency: string;
        merchant: string;
        hasReference: boolean;
        width: number;
        height: number;
    };
}>;
//# sourceMappingURL=bigbasket-upi.d.ts.map