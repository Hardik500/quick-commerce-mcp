import { spawn } from 'node:child_process';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserProfilePath } from '../dist/session-helper.js';

// Standard interactive Chrome with its own profile. Login/site checks remain
// normal browser interactions. Never attach this to the user's main profile.
const profile = browserProfilePath('bigbasket');
mkdirSync(profile, { recursive: true, mode: 0o700 });
chmodSync(profile, 0o700);
const executable = process.env.QC_CHROME_PATH;
if (!executable) throw new Error('Set QC_CHROME_PATH to the installed Chrome executable.');
const browser = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'https://www.bigbasket.com'], { stdio: 'ignore' });
let endpoint;
for (let attempt = 0; attempt < 100 && !endpoint; attempt++) {
  if (browser.exitCode !== null) throw new Error('Chrome exited; close any other browser using the BigBasket profile.');
  try {
    const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      const candidate = `http://127.0.0.1:${port}`;
      if ((await fetch(`${candidate}/json/version`)).ok) endpoint = candidate;
    }
  } catch { /* browser is still starting */ }
  if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
}
if (!endpoint) throw new Error('Chrome did not expose its local debugging endpoint.');
console.log(`Interactive BigBasket browser ready. QC_BIGBASKET_CDP_URL=${endpoint}`);
await new Promise(resolve => browser.once('exit', resolve));
