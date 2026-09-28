/**
 * Session persistence helpers, shared by the MCP server and platform
 * implementations.
 *
 * Sessions are stored as Playwright `storageState()` snapshots (cookies +
 * localStorage + sessionStorage), not just cookies, since SPAs like Zepto
 * keep auth tokens in localStorage.
 *
 * Interactive login usage:
 *   npx tsx src/session-helper.ts login zepto
 *   -> log in manually in the opened browser, then press Ctrl+C.
 *      The session is saved on SIGINT/SIGTERM before the process exits.
 */
export declare function ensureSessionDir(): void;
export declare function sessionPath(platform: string): string;
/**
 * Interactive login helper - opens a browser for manual login.
 * Saves the session (storageState) when the user presses Ctrl+C.
 */
export declare function interactiveLogin(platform: string): Promise<void>;
//# sourceMappingURL=session-helper.d.ts.map