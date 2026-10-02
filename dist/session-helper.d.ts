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
/**
 * Screenshot options that keep a payload inside the ~1 MB cap clients impose on
 * tool results (Claude Desktop drops anything larger without saying so).
 *
 * The context runs at deviceScaleFactor 3, so a default PNG screenshot captures
 * 9x the pixels. Measured on this checkout UI: a full page was 628 KB base64 as
 * a 3x PNG - under the cap but close enough that the denser payment page crosses
 * it. `scale: 'css'` removes the 3x multiplier, which is what actually frees the
 * space.
 *
 * Quality stays high (q95) because the QR is the whole point and has to remain
 * scannable; at CSS scale it is ~44 KB, so there is no reason to compress it
 * further. Only the full-page fallback is large enough to matter, and it lands
 * near 100 KB at this setting.
 */
export declare const SCREENSHOT_OPTS: {
    type: "jpeg";
    quality: number;
    scale: "css";
};
/**
 * Capture options for a cropped QR.
 *
 * PNG rather than JPEG: a QR is a hard edge pattern, and JPEG ringing around
 * the modules is exactly what stops scanners from reading it. Once the crop
 * removes the page, the PNG is small enough for the payload cap anyway.
 */
export declare const QR_OPTS: {
    type: "png";
    scale: "css";
};
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