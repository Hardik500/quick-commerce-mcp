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
    storageStatePath?: string;
}
/** Overrides the "chrome" channel; only used to point tests at a local build. */
export declare const CHROME_PATH_ENV = "QC_CHROME_PATH";
export declare class StealthBrowser {
    private browser;
    private context;
    launch(config?: StealthConfig): Promise<BrowserContext>;
    close(): Promise<void>;
    getContext(): BrowserContext | null;
}
//# sourceMappingURL=stealth-browser.d.ts.map