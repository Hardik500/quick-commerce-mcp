/**
 * Automates Swiggy Instamart login up to the OTP; prompts for the OTP on
 * stdin, submits it, and saves the session.
 *
 * Run: INSPECT_PHONE=9876543210 npx tsx scripts/auto-login-instamart.ts
 */
import * as readline from 'readline';
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath, ensureSessionDir } from '../src/session-helper.js';

function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

const DUMP_INPUTS = `[...document.querySelectorAll('input')]
  .filter(i => i.getBoundingClientRect().width > 0)
  .map(i => ({ type: i.type, name: i.name, id: i.id, testid: i.getAttribute('data-testid'), max: i.maxLength }))`;

async function main() {
  const phone = process.env.INSPECT_PHONE;
  if (!phone) {
    console.error('Set INSPECT_PHONE=<10-digit number> env var.');
    process.exit(1);
  }

  const stealth = new StealthBrowser();
  const context = await stealth.launch({ headless: false, slowMo: 100 });
  const page = await context.newPage();
  // Swiggy's mobile site shows "Rotate your device" in landscape viewports.
  await page.setViewportSize({ width: 390, height: 844 });

  try {
    console.log('📱 Navigating to Instamart...');
    await page.goto('https://www.swiggy.com/instamart', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Location modal: "Share location" (geolocation granted by StealthBrowser).
    const gps = await page.$('[data-testid="set-gps-button"]');
    if (gps) {
      await gps.click();
      await page.waitForTimeout(3000);
    }

    await page.click('[data-testid="user-account-icon"]');
    await page.waitForSelector('[data-testid="input-field-tel-national"]', { timeout: 15000 });
    // fill() doesn't trigger React's onChange here (form falls back to a
    // native GET submit), so type real keystrokes.
    // Keystrokes typed before hydration finishes get dropped, so verify and retry.
    const telInput = '[data-testid="input-field-tel-national"]';
    await page.waitForTimeout(3000);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click(telInput, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.keyboard.type(phone, { delay: 120 });
      await page.waitForTimeout(800);
      const typed = (await page.inputValue(telInput)).replace(/\D/g, '');
      if (typed === phone) break;
      console.log(`Phone field read "${typed}", retrying...`);
    }
    await page.click('button:has-text("CONTINUE")');
    await page.waitForTimeout(4000);

    console.log('OTP screen URL:', page.url());
    console.log('OTP screen inputs:', JSON.stringify(await page.evaluate(DUMP_INPUTS)));
    await page.screenshot({ path: 'logs/instamart-otp-screen.png' });

    const otp = (await readLine('Enter the OTP: ')).trim();
    const otpInput = await page.$('input:not([data-testid="input-field-tel-national"]):not([data-testid="input-field-tel-country-code"])');
    if (otpInput) {
      await otpInput.click();
      await page.keyboard.type(otp);
    } else {
      await page.keyboard.type(otp);
    }
    await page.waitForTimeout(1500);
    const verifyBtn = await page.$('button:has-text("VERIFY"), button:has-text("CONTINUE"), button:has-text("SUBMIT")');
    if (verifyBtn) await verifyBtn.click().catch(() => {});
    await page.waitForTimeout(8000);

    console.log('Post-OTP URL:', page.url());
    await page.screenshot({ path: 'logs/instamart-post-otp.png' });
    const cookies = await context.cookies();
    console.log('cookies:', cookies.map(c => c.name).join(', '));

    ensureSessionDir();
    await context.storageState({ path: sessionPath('swiggy-instamart') });
    console.log('✅ Session saved to', sessionPath('swiggy-instamart'));
  } finally {
    await stealth.close();
  }
}

main().catch(console.error);
