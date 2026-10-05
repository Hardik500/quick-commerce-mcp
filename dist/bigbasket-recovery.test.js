import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { BigBasketPlatform } from './platforms/bigbasket.js';
test('blocked BigBasket login gives dedicated-profile recovery without sending OTP', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let requests = 0;
    await context.route('https://www.bigbasket.com/**', async (route) => {
        requests++;
        await route.fulfill({ contentType: 'text/html', body: '<body>Access Denied</body>' });
    });
    try {
        const platform = new BigBasketPlatform();
        await platform.initialize(context);
        const status = await platform.checkLogin();
        assert.equal(status.indeterminate, true);
        assert.match(status.reason, /quick-commerce-mcp-bigbasket-browser/);
        assert.match(status.reason, /restart the MCP client/);
        assert.match(status.reason, /unrelated browser/);
        await assert.rejects(platform.sendOtp('9000000000'), /blocked this browser/);
        assert.equal(requests, 1);
    }
    finally {
        await browser.close();
    }
});
test('published recovery helper registers a private attachable endpoint and removes only its own registry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'qc-recovery-'));
    const shim = join(home, 'home.mjs');
    await writeFile(shim, `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; os.homedir = () => ${JSON.stringify(home)}; syncBuiltinESMExports();`);
    const child = spawn(process.execPath, ['--import', shim, 'scripts/open-bigbasket-browser.mjs'], {
        env: { ...process.env, QC_BIGBASKET_BROWSER_MODE: 'headless', QC_CHROME_PATH: chromium.executablePath() },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const closed = once(child, 'exit');
    const registry = join(home, '.quick-commerce-mcp/profiles/bigbasket/interactive-endpoint.json');
    try {
        for (let n = 0; n < 250 && !output.includes('browser ready') && child.exitCode === null; n++)
            await new Promise(resolve => setTimeout(resolve, 100));
        assert.match(output, /browser ready/, errors);
        const record = JSON.parse(await readFile(registry, 'utf8'));
        const browser = await chromium.connectOverCDP(record.endpoint);
        try {
            const page = await browser.contexts()[0].newPage();
            await page.goto('data:text/html,<title>Dedicated recovery</title>');
            assert.equal(await page.title(), 'Dedicated recovery');
        }
        finally {
            await browser.close();
        }
        await assert.rejects(promisify(execFile)(process.execPath, ['--import', shim, 'scripts/open-bigbasket-browser.mjs'], { env: { ...process.env, QC_BIGBASKET_BROWSER_MODE: 'headless', QC_CHROME_PATH: chromium.executablePath() }, timeout: 5000 }), /already running/);
        assert.equal(JSON.parse(await readFile(registry, 'utf8')).endpoint, record.endpoint);
        // Another browser can replace the registry before this helper shuts down.
        await writeFile(registry, JSON.stringify({ endpoint: 'http://127.0.0.1:1' }));
        child.kill('SIGTERM');
        await closed;
        assert.equal(JSON.parse(await readFile(registry, 'utf8')).endpoint, 'http://127.0.0.1:1');
        await access(registry);
    }
    finally {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await closed;
        }
        await rm(home, { recursive: true, force: true });
    }
});
//# sourceMappingURL=bigbasket-recovery.test.js.map