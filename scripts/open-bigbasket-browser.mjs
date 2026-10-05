#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { browserProfilePath } from '../dist/session-helper.js';
import { bigBasketBrowserArgs } from '../dist/browser-runtime.js';

if (process.argv.includes('--help')) {
  console.log('Usage: quick-commerce-mcp-bigbasket-browser [--visible]\nWindows defaults to an isolated background desktop; other systems use a visible dedicated browser. Keep this terminal running and restart your MCP client. Install Chromium with npx playwright install chromium, or set QC_CHROME_PATH. Login in an unrelated browser is not shared with MCP.');
  process.exit(0);
}
const mode = process.argv.includes('--visible') ? 'visible' : (process.env.QC_BIGBASKET_BROWSER_MODE ?? (process.platform === 'win32' ? 'background' : 'visible'));
if (!['visible', 'headless', 'background'].includes(mode)) throw new Error('Unknown BigBasket browser mode.');
if (mode === 'background' && process.platform !== 'win32') throw new Error('Background desktop mode requires Windows. From WSL use scripts/bigbasket-windows-bridge.mjs; on macOS/Linux use --visible.');
const profile = browserProfilePath('bigbasket');
const registry = join(profile, 'interactive-endpoint.json');
const executable = process.env.QC_CHROME_PATH || chromium.executablePath();
if (!existsSync(executable)) throw new Error('Chromium is missing. Run npx playwright install chromium, or set QC_CHROME_PATH to an installed Chrome executable.');
mkdirSync(profile, { recursive: true, mode: 0o700 });
chmodSync(profile, 0o700);
try {
  const record = JSON.parse(readFileSync(registry, 'utf8'));
  const url = new URL(record.endpoint);
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') {
    if ((await fetch(new URL('/json/version', url), { signal: AbortSignal.timeout(1500) })).ok) throw new Error('BigBasket recovery browser is already running. Keep its terminal open; restart MCP to attach, or close that browser before changing modes.');
  }
} catch (error) { if (error.message?.includes('already running')) throw error; }
try { rmSync(join(profile, 'DevToolsActivePort')); } catch { /* no old endpoint */ }
const browser = mode === 'background'
  ? spawn(process.execPath, [fileURLToPath(new URL('./bigbasket-windows-worker.mjs', import.meta.url)), executable, profile, mode], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  : spawn(executable, bigBasketBrowserArgs(profile, mode === 'headless').map(arg => arg === 'https://www.bigbasket.com' ? 'about:blank' : arg), { stdio: 'ignore', windowsHide: true });
let endpoint;
let isolated = mode !== 'background';
let launchError;
browser.once('error', () => { launchError = new Error('BigBasket browser could not be started. Check QC_CHROME_PATH and Chromium installation.'); });
if (mode === 'background') createInterface({ input: browser.stdout }).on('line', line => {
  try { const record = JSON.parse(line); if (record.kind === 'ready' && record.isolated === true) isolated = true; } catch { /* never log browser frames */ }
});
function clearRegistry() {
  try { if (endpoint && JSON.parse(readFileSync(registry, 'utf8')).endpoint === endpoint) rmSync(registry); } catch { /* only clear our endpoint */ }
}
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true; clearRegistry();
  if (mode === 'background' && browser.stdin.writable) browser.stdin.end(JSON.stringify({ kind: 'shutdown' }) + '\n');
  else browser.kill('SIGTERM');
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
browser.once('exit', clearRegistry);
try {
  for (let attempt = 0; attempt < 200 && !endpoint; attempt++) {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error('Chrome exited. Close any other browser using the dedicated BigBasket profile before retrying.');
    try {
      const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      if (isolated && Number.isInteger(port) && port > 0 && port <= 65535) {
        const candidate = `http://127.0.0.1:${port}`;
        if ((await fetch(`${candidate}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) endpoint = candidate;
      }
    } catch { /* browser is still starting */ }
    if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!endpoint) throw new Error('BigBasket browser did not expose a verified local endpoint.');
  writeFileSync(registry, JSON.stringify({ endpoint, mode }), { mode: 0o600 });
  chmodSync(registry, 0o600);
  console.log(`BigBasket ${mode} browser ready. Keep this terminal open, restart Claude/MCP, then use check_login_status and login. Use --visible if a site check requires interaction. This dedicated profile is shared with MCP; your regular browser is not.`);
  if (browser.exitCode === null) await new Promise(resolve => browser.once('exit', resolve));
} catch (error) { shutdown(); throw error; }
