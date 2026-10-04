import type { Page } from 'playwright';
import type { OrderPreview } from './platforms/base.js';
export interface WalletStatus {
    provider?: string;
    balance?: number;
    total: number;
    shortfall?: number;
    status: 'ready' | 'insufficient_balance' | 'unavailable' | 'manual';
    message: string;
}
export interface WalletOrderResult {
    success: boolean;
    ready?: boolean;
    total?: number;
    wallet?: WalletStatus;
    submitted?: boolean;
    status?: string;
    orderId?: string;
    image?: Buffer;
    message: string;
}
export declare function walletFingerprint(preview: OrderPreview): string;
export declare function inspectWallet(page: Page, platform: string, total: number, provider?: string): Promise<WalletStatus>;
export declare function inspectWallets(page: Page, platform: string, total: number): Promise<WalletStatus[]>;
export declare class WalletCheckout {
    private journalPath?;
    private armed?;
    private pending;
    constructor(journalPath?: string | undefined);
    private hasPending;
    private record;
    prepare(page: Page, platform: string, preview: OrderPreview, provider?: string): Promise<WalletOrderResult>;
    submit(page: Page, platform: string, preview: OrderPreview, provider?: string): Promise<WalletOrderResult>;
}
//# sourceMappingURL=wallet.d.ts.map