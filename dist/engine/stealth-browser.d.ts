/**
 * Stealth browser configuration for evading anti-bot detection
 * Combines playwright-stealth with custom evasion techniques
 */
import { BrowserContext } from 'playwright';
export interface StealthConfig {
    headless?: boolean;
    slowMo?: number;
    proxy?: string;
    userAgent?: string;
    viewport?: {
        width: number;
        height: number;
    };
}
export declare class StealthBrowser {
    private browser;
    private context;
    launch(config?: StealthConfig): Promise<BrowserContext>;
    close(): Promise<void>;
    getContext(): BrowserContext | null;
}
//# sourceMappingURL=stealth-browser.d.ts.map