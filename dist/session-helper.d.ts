/**
 * Debug script to capture authenticated session from a real browser
 *
 * Run this after manually logging in to Zepto through Playwright's debug mode:
 *
 * 1. Run: npx playwright codegen --device="iPhone 14" https://www.zeptonow.com
 * 2. Log in with OTP in the opened browser
 * 3. Close the browser
 * 4. Copy the session data from the Playwright trace
 *
 * Or use this script with a pre-authenticated session export.
 */
declare const SESSION_DIR: string;
export declare function saveSession(context: any, platform: string): Promise<void>;
export declare function loadSession(context: any, platform: string): Promise<boolean>;
/**
 * Interactive login helper - opens a browser for manual login
 */
export declare function interactiveLogin(platform: string): Promise<void>;
export { SESSION_DIR };
//# sourceMappingURL=session-helper.d.ts.map