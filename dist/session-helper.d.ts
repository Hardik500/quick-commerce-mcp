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
/**
 * Screenshot options for general page captures: small enough to sit inside the
 * ~1 MB cap clients impose on tool results (Claude Desktop drops anything larger
 * without saying so), but still legible.
 *
 * The context runs at deviceScaleFactor 3, so a default PNG screenshot captures
 * 9x the pixels - a full page measured 628 KB base64 as a 3x PNG, close enough to
 * the cap that the denser payment page crosses it. `scale: 'css'` removes the 3x
 * multiplier, which is what actually frees the space. JPEG at q95 is used because
 * these captures are UI screenshots with text, where the file size matters and the
 * hard edges of a QR are not involved. See QR_OPTS for the payment QR, which is
 * the opposite trade.
 */
export declare const SCREENSHOT_OPTS: {
    type: "jpeg";
    quality: number;
    scale: "css";
};
/**
 * Screenshot options for the payment QR: lossless PNG, because a QR is made of
 * hard-edged modules and JPEG's ringing and chroma subsampling around those edges
 * is exactly what stops scanners reading it. Quality is not a trade worth making
 * here - at CSS scale a 230x230 crop is ~9 KB, so PNG costs nothing.
 *
 * `scale: 'css'` also keeps the capture at the QR's native 230x230 rather than
 * upscaling it 3x, which is the highest fidelity available from a screenshot.
 */
export declare const QR_OPTS: {
    type: "png";
    scale: "css";
};
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