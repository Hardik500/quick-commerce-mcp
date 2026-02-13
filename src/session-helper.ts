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

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_DIR = path.join(process.cwd(), 'data', 'sessions');

export async function saveSession(context: any, platform: string): Promise<void> {
  const sessionPath = path.join(SESSION_DIR, `${platform}-session.json`);
  
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const cookies = await context.cookies();
  const localStorage = await context.pages()[0]?.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        items[key] = localStorage.getItem(key) || '';
      }
    }
    return items;
  });

  fs.writeFileSync(sessionPath, JSON.stringify({
    cookies,
    localStorage,
    savedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`✅ Session saved to ${sessionPath}`);
}

export async function loadSession(context: any, platform: string): Promise<boolean> {
  const sessionPath = path.join(SESSION_DIR, `${platform}-session.json`);

  if (!fs.existsSync(sessionPath)) {
    console.log(`No saved session found at ${sessionPath}`);
    return false;
  }

  try {
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    
    // Check if session is recent (within 24 hours)
    const savedAt = new Date(sessionData.savedAt);
    const hoursAgo = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      console.log(`⚠️ Session is ${hoursAgo.toFixed(1)} hours old, may be expired`);
    }

    // Restore cookies
    await context.addCookies(sessionData.cookies);
    console.log(`✅ Loaded ${sessionData.cookies.length} cookies`);

    return true;
  } catch (error) {
    console.log(`❌ Failed to load session: ${error}`);
    return false;
  }
}

/**
 * Interactive login helper - opens a browser for manual login
 */
export async function interactiveLogin(platform: string): Promise<void> {
  console.log(`\n🔐 Interactive Login for ${platform.toUpperCase()}`);
  console.log('=====================================\n');
  console.log('A browser window will open. Please:');
  console.log('1. Allow location access if prompted');
  console.log('2. Enter your phone number');
  console.log('3. Enter the OTP you receive');
  console.log('4. Complete the login process');
  console.log('\nThe session will be saved automatically.\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });

  // Open DevTools manually - devtools option not available in launchOptions

  const page = await context.newPage();

  // Try to load existing session
  await loadSession(context, platform);

  const url = platform === 'zepto' 
    ? 'https://www.zeptonow.com'
    : platform === 'swiggy' || platform === 'swiggy-instamart'
    ? 'https://www.swiggy.com/instamart'
    : 'https://www.blinkit.com';

  console.log(`📱 Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  console.log('\n⏳ Waiting for you to log in...');
  console.log('Press Ctrl+C when you have successfully logged in.\n');

  // Wait indefinitely until user closes
  await new Promise(() => {}); // Never resolves, user must Ctrl+C
}

// CLI usage
const args = process.argv.slice(2);
if (args[0] === 'login' && args[1]) {
  interactiveLogin(args[1]).catch(console.error);
}

export { SESSION_DIR };