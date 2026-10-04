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
    private graphics;
    prepare(page: Page, preview: OrderPreview): Promise<WalletOrderResult>;
    submit(page: Page, preview: OrderPreview): Promise<WalletOrderResult>;
}
//# sourceMappingURL=bigbasket-upi.d.ts.map