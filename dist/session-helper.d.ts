#!/usr/bin/env node
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
/** Where a payment QR is written for the user to open. Unique per attempt. */
export declare function qrPath(total: number): string;
/**
 * Write a payment QR to disk so the user can open it.
 *
 * Not every MCP client renders image blocks from tool results - Claude Desktop
 * drops them silently - and a QR the user cannot see is a QR they cannot pay
 * with. Returns the path, or undefined if it could not be written; the caller
 * still returns the image block for clients that do render it.
 */
export declare function saveQrImage(image: Buffer | undefined, total: number): string | undefined;
/**
 * Interactive login helper - opens a browser for manual login.
 * Saves the session (storageState) when the user presses Ctrl+C.
 */
export declare function interactiveLogin(platform: string): Promise<void>;
//# sourceMappingURL=session-helper.d.ts.map