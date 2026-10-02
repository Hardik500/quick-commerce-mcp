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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StealthBrowser } from './engine/stealth-browser.js';
// Uses the user's home directory, not process.cwd(), since this is invoked
// via `npx quick-commerce-mcp` where cwd is an ephemeral npx cache dir that
// differs across runs - a relative path here would lose the session every time.
const SESSION_DIR = path.join(os.homedir(), '.quick-commerce-mcp', 'sessions');
const PLATFORM_URLS = {
    zepto: 'https://www.zeptonow.com',
    swiggy: 'https://www.swiggy.com/instamart',
    'swiggy-instamart': 'https://www.swiggy.com/instamart',
    blinkit: 'https://www.blinkit.com',
};
/** Canonical session file name for a platform (aliases collapse to one file). */
function canonicalPlatform(platform) {
    return platform === 'swiggy' ? 'swiggy-instamart' : platform;
}
export function ensureSessionDir() {
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
}
export function sessionPath(platform) {
    return path.join(SESSION_DIR, `${canonicalPlatform(platform)}-session.json`);
}
/** Where a payment QR is written for the user to open. Unique per attempt. */
export function qrPath(total) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(SESSION_DIR, `payment-qr-${stamp}-${total}.png`);
}
/**
 * Write a payment QR to disk so the user can open it.
 *
 * Not every MCP client renders image blocks from tool results - Claude Desktop
 * drops them silently - and a QR the user cannot see is a QR they cannot pay
 * with. Returns the path, or undefined if it could not be written; the caller
 * still returns the image block for clients that do render it.
 */
export function saveQrImage(image, total) {
    if (!image?.length)
        return undefined;
    try {
        ensureSessionDir();
        const file = qrPath(total);
        fs.writeFileSync(file, image);
        return file;
    }
    catch {
        return undefined;
    }
}
/**
 * Interactive login helper - opens a browser for manual login.
 * Saves the session (storageState) when the user presses Ctrl+C.
 */
export async function interactiveLogin(platform) {
    const url = PLATFORM_URLS[platform];
    if (!url) {
        throw new Error(`Unknown platform: ${platform}`);
    }
    console.log(`\n🔐 Interactive Login for ${platform.toUpperCase()}`);
    console.log('=====================================\n');
    console.log('A browser window will open. Please:');
    console.log('1. Allow location access if prompted');
    console.log('2. Enter your phone number');
    console.log('3. Enter the OTP you receive');
    console.log('4. Complete the login process');
    console.log('\nPress Ctrl+C when done - the session will be saved then.\n');
    const stealth = new StealthBrowser();
    const savedSession = sessionPath(platform);
    const context = await stealth.launch({
        headless: false,
        slowMo: 200,
        storageStatePath: fs.existsSync(savedSession) ? savedSession : undefined,
    });
    const page = await context.newPage();
    console.log(`📱 Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log('\n⏳ Waiting for you to log in...');
    console.log('Press Ctrl+C when you have successfully logged in.\n');
    ensureSessionDir();
    const filePath = sessionPath(platform);
    const saveAndExit = async () => {
        try {
            await context.storageState({ path: filePath });
            console.log(`\n✅ Session saved to ${filePath}`);
        }
        catch (error) {
            console.error('❌ Failed to save session:', error);
        }
        finally {
            process.exit(0);
        }
    };
    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);
    // Also save+exit if the user closes the browser window directly (instead
    // of pressing Ctrl+C), so that path doesn't lose the session either.
    context.on('close', saveAndExit);
    // Wait indefinitely until Ctrl+C or the browser closes (handled above)
    await new Promise(() => { });
}
// CLI usage. Supports both:
//   npx tsx src/session-helper.ts login <platform>   (dev)
//   npx quick-commerce-mcp-login <platform>           (published bin, "login" implied by the command name)
// Guarded so importing this module as a library (e.g. from index.ts for
// sessionPath()) doesn't also trigger the CLI / process.exit(1).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const args = process.argv.slice(2);
    const platformArg = args[0] === 'login' ? args[1] : args[0];
    if (platformArg) {
        interactiveLogin(platformArg).catch(console.error);
    }
    else {
        console.error('Usage: quick-commerce-mcp-login <platform>  (e.g. zepto)');
        process.exit(1);
    }
}
//# sourceMappingURL=session-helper.js.map