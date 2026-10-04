import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { StealthBrowser, CHROME_PATH_ENV } from './engine/stealth-browser.js';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
test('desktop browser retains native iframe APIs, UA and desktop device properties', async () => {
    const previous = process.env[CHROME_PATH_ENV];
    process.env[CHROME_PATH_ENV] = chromium.executablePath();
    const browser = new StealthBrowser();
    try {
        const context = await browser.launch({ desktop: true, headless: true, slowMo: 0 });
        const page = await context.newPage();
        await page.setContent('<iframe srcdoc="<p>Payment frame</p>"></iframe>');
        const properties = await page.evaluate(() => ({
            ua: navigator.userAgent,
            scale: devicePixelRatio,
            touch: navigator.maxTouchPoints,
            // The mobile patch incorrectly invokes the contentWindow getter.
            frameAccessible: Boolean(document.querySelector('iframe').contentWindow.document),
            nativeEval: Function.prototype.toString.call(window.eval).includes('[native code]'),
        }));
        assert.match(properties.ua, /Chrome\//);
        assert.doesNotMatch(properties.ua, /iPhone|Mobile/);
        assert.equal(properties.scale, 1);
        assert.equal(properties.touch, 0);
        assert.equal(properties.frameAccessible, true);
        assert.equal(properties.nativeEval, true);
    }
    finally {
        await browser.close();
        if (previous === undefined)
            delete process.env[CHROME_PATH_ENV];
        else
            process.env[CHROME_PATH_ENV] = previous;
    }
});
test('dedicated desktop profile persists cookies across browser restarts with private permissions', async () => {
    const previous = process.env[CHROME_PATH_ENV];
    process.env[CHROME_PATH_ENV] = chromium.executablePath();
    const profile = mkdtempSync(join(tmpdir(), 'qc-profile-'));
    const first = new StealthBrowser();
    const second = new StealthBrowser();
    try {
        const context = await first.launch({ desktop: true, headless: true, userDataDir: profile, slowMo: 0 });
        await context.addCookies([{ name: 'fixture-login', value: 'fixture', domain: 'example.com', path: '/',
                expires: Math.floor(Date.now() / 1000) + 3600, secure: true, httpOnly: true }]);
        await first.close();
        const restored = await second.launch({ desktop: true, headless: true, userDataDir: profile, slowMo: 0 });
        assert.equal((await restored.cookies('https://example.com')).some(c => c.name === 'fixture-login'), true);
        assert.equal(statSync(profile).mode & 0o777, 0o700);
        await assert.rejects(new StealthBrowser().launch({ userDataDir: profile }), /desktop mode/);
    }
    finally {
        await first.close();
        await second.close();
        rmSync(profile, { recursive: true, force: true });
        if (previous === undefined)
            delete process.env[CHROME_PATH_ENV];
        else
            process.env[CHROME_PATH_ENV] = previous;
    }
});
test('logout clears dedicated browser cookies, local storage and cached authenticated pages', async () => {
    const previous = process.env[CHROME_PATH_ENV];
    process.env[CHROME_PATH_ENV] = chromium.executablePath();
    const server = createServer((_request, response) => response.end('<p>Account fixture</p>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = new StealthBrowser();
    try {
        const context = await browser.launch({ desktop: true, headless: true, slowMo: 0 });
        const page = await context.newPage();
        await page.goto(origin);
        await page.evaluate(() => { localStorage.setItem('fixture-login', 'fixture'); });
        await context.addCookies([{ name: 'fixture-login', value: 'fixture', url: origin }]);
        await browser.clearAuthentication();
        assert.equal((await context.cookies()).length, 0);
        assert.equal(page.url(), 'about:blank');
        await page.goto(origin);
        assert.equal(await page.evaluate(() => localStorage.getItem('fixture-login')), null);
    }
    finally {
        await browser.close();
        await new Promise(resolve => server.close(() => resolve()));
        if (previous === undefined)
            delete process.env[CHROME_PATH_ENV];
        else
            process.env[CHROME_PATH_ENV] = previous;
    }
});
test('interactive attachment rejects remote endpoints and URLs containing credentials or query data', async () => {
    for (const endpoint of ['https://localhost:1234', 'http://example.com', 'http://user:password@localhost:1234', 'http://localhost:1234?token=fixture', 'http://localhost:1234/path']) {
        await assert.rejects(new StealthBrowser().launch({ desktop: true, cdpEndpoint: endpoint }), /loopback HTTP/);
    }
});
test('fresh MCP clients launch installed Chromium without a client-specific executable override', async () => {
    const previous = process.env[CHROME_PATH_ENV];
    delete process.env[CHROME_PATH_ENV];
    const profile = mkdtempSync(join(tmpdir(), 'qc-default-profile-'));
    try {
        for (const userDataDir of [undefined, profile]) {
            const browser = new StealthBrowser();
            try {
                const context = await browser.launch({ desktop: true, headless: true, slowMo: 0, userDataDir });
                const page = await context.newPage();
                await page.setContent('<p>Fresh MCP browser</p>');
                assert.equal(await page.textContent('p'), 'Fresh MCP browser');
            }
            finally {
                await browser.close();
            }
        }
    }
    finally {
        rmSync(profile, { recursive: true, force: true });
        if (previous === undefined)
            delete process.env[CHROME_PATH_ENV];
        else
            process.env[CHROME_PATH_ENV] = previous;
    }
});
//# sourceMappingURL=desktop-browser.test.js.map