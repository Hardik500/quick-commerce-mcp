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
    desktop?: boolean;
    /** Dedicated native desktop profile; never point at a user's main profile. */
    userDataDir?: string;
    /** Attach to a user-controlled local interactive Chrome browser. */
    cdpEndpoint?: string;
}
/** Explicit Chrome/Chromium executable override for local MCP deployments. */
export declare const CHROME_PATH_ENV = "QC_CHROME_PATH";
export declare class StealthBrowser {
    private browser;
    private context;
    private attached;
    launch(config?: StealthConfig): Promise<BrowserContext>;
    /** Erase authentication from a dedicated attached browser before disconnecting. */
    clearAuthentication(): Promise<void>;
    close(): Promise<void>;
    getContext(): BrowserContext | null;
}
//# sourceMappingURL=stealth-browser.d.ts.map