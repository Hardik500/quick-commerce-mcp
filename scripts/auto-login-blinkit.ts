/**
 * Automates everything up to the OTP screen for Blinkit login, so the user
 * only has to type the OTP that arrives via SMS into the visible browser.
 *
 * Run: INSPECT_PHONE=9876543210 npx tsx scripts/auto-login-blinkit.ts
 * Then: type the OTP in the browser, complete login, press Ctrl+C here to
 * save the session (same save-on-signal behavior as session-helper.ts).
 */
import * as fs from 'fs';
import * as readline from 'readline';
import { StealthBrowser } from '../src/engine/stealth-browser.js';
import { sessionPath, ensureSessionDir } from '../src/session-helper.js';

function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const phone = process.env.INSPECT_PHONE;
  if (!phone) {
    console.error('Set INSPECT_PHONE=<10-digit number> env var.');
    process.exit(1);
  }

  const stealth = new StealthBrowser();
  const savedSession = sessionPath('blinkit');
  const context = await stealth.launch({
    headless: false,
    slowMo: 150,
    storageStatePath: fs.existsSync(savedSession) ? savedSession : undefined,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  console.log('📱 Navigating to Blinkit...');
  await page.goto('https://www.blinkit.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Dismiss the "Get the app" interstitial.
  const continueOnWeb = await page.$('text=Continue on web');
  if (continueOnWeb) {
    await continueOnWeb.click();
    await page.waitForTimeout(1500);
  }

  // Resolve the "Select your location" modal (geolocation permission is
  // already granted by StealthBrowser).
  const useLocationBtn = await page.$('text=Use my location');
  if (useLocationBtn) {
    await useLocationBtn.click();
    await page.waitForTimeout(3000);
  }

  // Open the login modal via the profile icon.
  const profileIcon = await page.$('[class*="profile" i]');
  if (!profileIcon) {
    console.error('❌ Could not find profile/login trigger.');
    await stealth.close();
    return;
  }
  await profileIcon.click();
  await page.waitForTimeout(2000);

  // Fill phone number and submit.
  const phoneInput = await page.$('input[data-test-id="phone-no-text-box"]');
  if (!phoneInput) {
    console.log('⚠️  Already logged in, or phone input not found - check the browser window.');
  } else {
    await phoneInput.fill(phone);
    const continueBtn = await page.$('button:has-text("Continue")');
    if (continueBtn) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
      console.log('\n✅ OTP requested and sent via SMS.');

      const otp = await readLine('Enter the 4-digit OTP: ');
      const firstOtpBox = await page.$('[data-test-id="otp-text-box"]');
      if (firstOtpBox) {
        await firstOtpBox.click();
        await page.keyboard.type(otp.trim());
        await page.waitForTimeout(3000);
        console.log('✅ OTP submitted.');
      } else {
        console.log('⚠️  OTP input not found - enter it manually in the browser.');
      }
    }
  }

  console.log('\n⏳ Verify you\'re logged in (check the browser), then press Ctrl+C here to save the session.\n');

  ensureSessionDir();
  const filePath = sessionPath('blinkit');

  const saveAndExit = async () => {
    try {
      await context.storageState({ path: filePath });
      console.log(`\n✅ Session saved to ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to save session:', error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);
  context.on('close', saveAndExit);

  await new Promise(() => {});
}

main().catch(console.error);
