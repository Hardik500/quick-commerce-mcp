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
import * as path from 'path';
import { StealthBrowser } from './engine/stealth-browser.js';
const SESSION_DIR = path.join(process.cwd(), 'data', 'sessions');
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
// CLI usage
const args = process.argv.slice(2);
if (args[0] === 'login' && args[1]) {
    interactiveLogin(args[1]).catch(console.error);
}
//# sourceMappingURL=session-helper.js.map