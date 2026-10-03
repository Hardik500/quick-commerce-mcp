#!/usr/bin/env node
/**
 * Session persistence helpers, shared by the MCP server and platform
 * implementations.
 *
 * Sessions are stored as Playwright `storageState()` snapshots (cookies +
 * localStorage), not just cookies, since SPAs like Zepto
 * keep auth tokens in localStorage.
 *
 * Interactive login usage:
 *   npx tsx src/session-helper.ts login zepto
 *   -> log in manually in the opened browser, then press Ctrl+C.
 *      The session is saved on SIGINT/SIGTERM before the process exits.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StealthBrowser } from './engine/stealth-browser.js';

// Uses the user's home directory, not process.cwd(), since this is invoked
// via `npx quick-commerce-mcp` where cwd is an ephemeral npx cache dir that
// differs across runs - a relative path here would lose the session every time.
const SESSION_DIR = path.join(os.homedir(), '.quick-commerce-mcp', 'sessions');

const PLATFORM_URLS: Record<string, string> = {
  zepto: 'https://www.zeptonow.com',
  swiggy: 'https://www.swiggy.com/instamart',
  'swiggy-instamart': 'https://www.swiggy.com/instamart',
  blinkit: 'https://www.blinkit.com',
};

/** Canonical session file name for a platform (aliases collapse to one file). */
function canonicalPlatform(platform: string): string {
  return platform === 'swiggy' ? 'swiggy-instamart' : platform;
}

export function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function sessionPath(platform: string): string {
  return path.join(SESSION_DIR, `${canonicalPlatform(platform)}-session.json`);
}

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
export const SCREENSHOT_OPTS = {
  type: 'jpeg' as const,
  quality: 95,
  scale: 'css' as const,
};

/**
 * Screenshot options for the payment QR: lossless PNG, because a QR is made of
 * hard-edged modules and JPEG's ringing and chroma subsampling around those edges
 * is exactly what stops scanners reading it. Quality is not a trade worth making
 * here - a CSS-scale crop of this QR measures 230-295 px depending on the sheet
 * and lands under 2 KB as PNG, so there is nothing to give up.
 *
 * `scale: 'css'` also keeps the capture at the QR's native size rather than
 * upscaling it 3x, which is the highest fidelity available from a screenshot.
 */
export const QR_OPTS = {
  type: 'png' as const,
  scale: 'css' as const,
};

/** Where a payment QR is written for the user to open. Unique per attempt. */
export function qrPath(total: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(SESSION_DIR, `payment-qr-${stamp}-${total}.png`);
}

/**
 * Open a saved QR in the host's image viewer, so the user gets it full size.
 *
 * Claude Desktop (and other MCP clients) render tool-result images inside a short
 * container with its own scrollbar, so a QR sent inline is clipped across the fold
 * and will not scan. There is no protocol-level way to change that layout, so
 * putting the real file on screen is the only route to a scannable code.
 *
 * Detached and unref'd, so the viewer outlives this call without holding the MCP
 * server's event loop open. Never throws and never blocks: a failed launch is not
 * worth failing an order over, and the path is still in the message either way.
 * Returns true only if the process was spawned.
 */
export function openQrViewer(file: string): boolean {
  try {
    if (!file?.length || !fs.existsSync(file)) return false;
    const [cmd, args] =
      process.platform === 'win32'
        ? // `start` treats its first quoted argument as a window title, so the
          // empty "" is required - without it a quoted path is treated as the
          // title and nothing opens.
          ['cmd', ['/c', 'start', '', file]]
        : process.platform === 'darwin'
          ? ['open', [file]]
          : ['xdg-open', [file]];
    const child = spawn(cmd as string, args as string[], {
      detached: true,
      stdio: 'ignore',
      // No shell: the path is passed as an argument, never interpolated into a
      // command line, so a path with spaces or & cannot become a command.
      shell: false,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a payment QR to disk so the user can open it.
 *
 * Not every MCP client renders image blocks from tool results - Claude Desktop
 * drops them silently - and a QR the user cannot see is a QR they cannot pay
 * with. Returns the path, or undefined if it could not be written; the caller
 * still returns the image block for clients that do render it.
 */
export function saveQrImage(image: Buffer | undefined, total: number): string | undefined {
  if (!image?.length) return undefined;
  try {
    ensureSessionDir();
    // qrPath already ends in .png, which matches the PNG bytes QR_OPTS produces.
    // The extension has to agree with the content or tools that sniff the file
    // (and the user's file manager) show the QR as a broken image.
    const file = qrPath(total);
    // 0600, like preferences.json: a UPI QR is a scannable payment instruction
    // carrying the payee VPA and the amount, so it should not be readable by
    // other local accounts the way a default 0644 file would be. A no-op on
    // Windows, which does not use POSIX modes.
    fs.writeFileSync(file, image, { mode: 0o600 });
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Interactive login helper - opens a browser for manual login.
 * Saves the session (storageState) when the user presses Ctrl+C.
 */
export async function interactiveLogin(platform: string): Promise<void> {
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
    } catch (error) {
      console.error('❌ Failed to save session:', error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);

  // Also save+exit if the user closes the browser window directly (instead
  // of pressing Ctrl+C), so that path doesn't lose the session either.
  context.on('close', saveAndExit);

  // Wait indefinitely until Ctrl+C or the browser closes (handled above)
  await new Promise(() => {});
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
  } else {
    console.error('Usage: quick-commerce-mcp-login <platform>  (e.g. zepto)');
    process.exit(1);
  }
}
