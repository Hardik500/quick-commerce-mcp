/**
 * Runtime selector overrides.
 *
 * Every selector in the platform classes is a guess about markup the sites can
 * change at any time. When one breaks, the fix should not need a code change or
 * an npm release: the agent inspects the live page, picks a better selector, and
 * writes it here. It is consulted before the built-in value on every later run,
 * including ones started by `npx quick-commerce-mcp`.
 *
 * Overrides live in ~/.quick-commerce-mcp/flows/<platform>.json so they survive
 * upgrades and are never overwritten by a new release of the package.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const FLOW_DIR = path.join(os.homedir(), '.quick-commerce-mcp', 'flows');
/** Steps an override may replace. Anything else is rejected. */
export const FLOW_STEPS = [
    'loginTrigger', 'phoneInput', 'otpInput', 'otpSubmit',
    'locationModal', 'locationSearch', 'locationSuggestion',
    'productCard', 'productName', 'productPrice', 'cartItem', 'addToCart',
];
function filePath(platform) {
    return path.join(FLOW_DIR, `${platform}.json`);
}
export function loadFlows(platform) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath(platform), 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Persist one step's selector. Rejects unknown steps and empty selectors. */
export function saveFlow(platform, step, selector) {
    if (!FLOW_STEPS.includes(step)) {
        throw new Error(`Unknown step "${step}". Known steps: ${FLOW_STEPS.join(', ')}`);
    }
    if (!selector.trim())
        throw new Error('selector must not be empty (pass a string to clear it instead)');
    const all = loadFlows(platform);
    all[step] = selector.trim();
    fs.mkdirSync(FLOW_DIR, { recursive: true });
    fs.writeFileSync(filePath(platform), JSON.stringify(all, null, 2));
    return all;
}
export function clearFlow(platform, step) {
    const all = loadFlows(platform);
    delete all[step];
    fs.mkdirSync(FLOW_DIR, { recursive: true });
    fs.writeFileSync(filePath(platform), JSON.stringify(all, null, 2));
    return all;
}
/**
 * The selector to use for a step: a runtime override if one exists, otherwise
 * the built-in. Keeping this the single entry point is what makes an override
 * take effect everywhere without touching the platform classes.
 */
export function selectorFor(platform, step, builtin) {
    const override = loadFlows(platform)[step];
    return override?.trim() || builtin;
}
/**
 * Resolve a step to a locator, trying the override first and then each built-in
 * candidate in turn. Returns the first that is actually present, so a site that
 * only partially changed keeps working.
 */
export async function pick(page, platform, step, builtins, waitMs = 0) {
    const override = loadFlows(platform)[step]?.trim();
    const candidates = override ? [override, ...builtins.filter(s => s !== override)] : builtins;
    for (const selector of candidates) {
        const locator = page.locator(selector).first();
        // waitMs > 0 is for elements that render after a click (a login panel, a
        // sheet); without it a one-shot count gives up before they appear.
        const ok = waitMs
            ? await locator.waitFor({ state: 'attached', timeout: waitMs }).then(() => true, () => false)
            : await locator.count().then(n => n > 0).catch(() => false);
        if (ok)
            return { locator, used: selector };
    }
    return null;
}
/**
 * Everything a human or agent needs to choose a replacement selector, without
 * having to guess at the markup: the interactive elements currently on the page
 * with the attributes that distinguish them.
 */
export async function fingerprint(page, limit = 40) {
    return page
        .evaluate((max) => {
        const lines = [];
        const push = (tag, el) => {
            if (lines.length >= max)
                return;
            const attrs = ['data-testid', 'data-test-id', 'data-test', 'data-testid', 'aria-label', 'name', 'role', 'placeholder', 'type', 'inputmode', 'autocomplete']
                .map(a => [a, el.getAttribute(a)])
                .filter(([, v]) => v)
                .map(([a, v]) => `${a}="${v}"`)
                .join(' ');
            const text = el.innerText?.replace(/\s+/g, ' ').trim().slice(0, 40) ?? '';
            const cls = typeof el.className === 'string' ? el.className : el.className?.baseVal;
            const r = el.getBoundingClientRect();
            lines.push(`<${tag.toLowerCase()}${attrs ? ' ' + attrs : ''}` +
                `${cls ? ` class="${cls.replace(/\s+/g, ' ').slice(0, 60)}"` : ''}` +
                `${text ? `>${text}<` : ' />'}  [${Math.round(r.width)}x${Math.round(r.height)}` +
                `${r.width && r.height ? '' : ' hidden/zero-size]'}`);
        };
        // Inputs first, then clickables: a form field is what a broken flow is usually
        // looking for, and a page full of anchors would otherwise push them past
        // the limit.
        const inputs = [...document.querySelectorAll('input')];
        const clickables = [...document.querySelectorAll('button, [role="button"], a, [role="dialog"]')];
        [...inputs, ...clickables].forEach(el => {
            // Zero-size nodes are listed, not skipped: a field inside a sheet that
            // has not finished laying out is exactly the thing being looked for.
            push(el.tagName, el);
        });
        return lines.join('\n');
    }, limit)
        .catch(() => '(could not read the page)');
}
/**
 * Check an override actually resolves on the live page before it is trusted, so
 * a bad one cannot wedge every future run.
 */
export async function verifyFlow(page, selector) {
    return page.locator(selector).first().count().then(n => n > 0).catch(() => false);
}
const facts = (page, scope) => page.evaluate((sel) => {
    const num = (s) => s.replace(/[^\d]/g, '');
    return [...document.querySelectorAll(sel)].map(el => {
        const e = el;
        const r = e.getBoundingClientRect();
        return {
            tag: e.tagName.toLowerCase(),
            id: e.id || '',
            testIds: ['data-testid', 'data-test-id', 'data-test'].map(a => e.getAttribute(a) || '').filter(Boolean),
            name: e.getAttribute('name') || '',
            ariaLabel: e.getAttribute('aria-label') || '',
            placeholder: e.getAttribute('placeholder') || '',
            type: (e.getAttribute('type') || '').toLowerCase(),
            inputMode: e.getAttribute('inputmode') || '',
            autoComplete: e.getAttribute('autocomplete') || '',
            text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            className: typeof e.className === 'string' ? e.className : e.className?.baseVal || '',
            visible: r.width > 0 && r.height > 0,
            numId: num(e.id),
        };
    });
}, scope);
/** A CSS selector for an element: the most stable thing that identifies it. */
function cssFor(f) {
    const tid = f.testIds[0];
    if (tid)
        return `[data-testid="${tid}"]`;
    if (f.id)
        return `#${CSS.escape(f.id)}`;
    if (f.ariaLabel)
        return `${f.tag}[aria-label="${f.ariaLabel}"]`;
    if (f.placeholder)
        return `${f.tag}[placeholder="${f.placeholder}"]`;
    if (f.name)
        return `${f.tag}[name="${f.name}"]`;
    const cls = f.className.split(/\s+/).filter(Boolean)[0];
    return cls ? `${f.tag}.${CSS.escape(cls)}` : f.tag;
}
const has = (hay, needle) => needle.test(hay);
const combined = (f) => [f.id, f.ariaLabel, f.placeholder, f.name, f.text, f.className, f.testIds.join(' ')].join(' ').toLowerCase();
/**
 * Oracles. Each proves the *whole* intent, not just that the element exists -
 * see the 10-digit check, which is what stops the country-code field being
 * mistaken for the national one.
 */
async function typeAndReadBack(loc, value) {
    await loc.click({ timeout: 4000 }).catch(() => { });
    await loc.fill('').catch(() => { });
    await loc.pressSequentially(value, { delay: 10 }).catch(() => { });
    return ((await loc.inputValue().catch(() => '')) ?? '').replace(/\D/g, '');
}
const INTENTS = {
    phoneInput: {
        scope: 'input',
        score: f => {
            if (f.tag !== 'input')
                return 0;
            let s = 0;
            if (f.type === 'tel')
                s += 30;
            if (f.inputMode === 'numeric' || f.inputMode === 'tel')
                s += 20;
            if (has(f.autoComplete, /tel/i))
                s += 15;
            if (has(combined(f), /phone|mobile|number/i))
                s += 20;
            if (has(f.testIds.join(' '), /national|phone|mobile/i))
                s += 20;
            // A field that stores a country code is a different field entirely.
            if (has(combined(f), /country|dial|iso/i))
                s -= 40;
            if (f.visible)
                s += 10;
            return Math.max(0, s);
        },
        oracle: async (_page, loc) => {
            // Must hold a full 10-digit Indian mobile number. This is the check that
            // rejects a 3-digit country-code box, or any field with a hidden cap.
            const got = await typeAndReadBack(loc, '9876543210');
            return got.length === 10;
        },
        blocker: 'No field on the page can hold a 10-digit mobile number. The form is either capped (a hard limit that no selector change can work around) or the flow needs more than one step.',
    },
    otpInput: {
        scope: 'input',
        score: f => {
            if (f.tag !== 'input')
                return 0;
            let s = 0;
            if (has(f.autoComplete, /one-time-code/i))
                s += 45;
            if (has(f.ariaLabel + f.name + f.testIds.join(' '), /otp|one.?time|verification.?code/i))
                s += 40;
            if (f.inputMode === 'numeric')
                s += 10;
            if (f.visible)
                s += 10;
            return Math.min(100, s);
        },
        oracle: async (_page, loc) => (await typeAndReadBack(loc, '123456')) === '123456',
        blocker: 'No single input accepts a 6-digit code. The site may use several separate boxes, which needs a different driver rather than a different selector.',
    },
    loginTrigger: {
        scope: 'button, [role="button"], a',
        score: f => {
            let s = 0;
            if (has(f.ariaLabel + f.testIds.join(' '), /login|log in|sign ?in|account|profile/i))
                s += 45;
            if (has(f.text, /login|sign ?in/i))
                s += 35;
            if (f.visible)
                s += 10;
            return Math.min(100, s);
        },
        // Decidable: clicking a login control must bring up a phone field. Proving
        // the effect (rather than just the existence of the button) is what keeps a
        // decorative "sign in" link from being adopted.
        oracle: async (page, loc) => {
            const before = await page.locator('input[type="tel"], input[inputmode="numeric"], input[autocomplete="tel"]').count();
            await loc.click({ timeout: 5000 }).catch(() => { });
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                if (await page.locator('input[type="tel"], input[inputmode="numeric"], input[autocomplete="tel"]').count() > before) {
                    return true;
                }
                await page.waitForTimeout(200);
            }
            return false;
        },
        blocker: 'No control on the page opens a login form. The session may already be signed in, or the trigger is behind a sheet that has to be dismissed first.',
    },
};
/**
 * Try to repair `step` on its own. Returns the adopted selector on success, or a
 * reason it declined. Never adopts without the oracle passing.
 */
export async function selfRepair(page, platform, step, builtins) {
    const intent = INTENTS[step];
    if (!intent)
        return { blocked: `No oracle is defined for "${step}", so nothing can be proven and no selector is guessed.`, rejected: [] };
    const candidates = await facts(page, intent.scope).catch(() => []);
    const rejected = [];
    const ranked = candidates
        .filter(c => intent.score(c) > 0)
        .sort((a, b) => intent.score(b) - intent.score(a));
    for (const cand of ranked.slice(0, 12)) {
        const selector = cssFor(cand);
        // Everything gets probed, including the built-in: "it matched nothing" and
        // "it matched but the step failed against it" are different failures and the
        // rejected list is how the caller tells them apart.
        if (loadFlows(platform)[step] === selector) {
            rejected.push(`${selector} (already the saved override)`);
            continue;
        }
        if (!intent.oracle)
            continue;
        const loc = page.locator(selector).first();
        let ok = false;
        try {
            ok = await intent.oracle(page, loc, cand);
        }
        catch {
            ok = false;
        }
        // Leave the field as we found it, so a failed probe cannot leak into a cart.
        await loc.fill('').catch(() => { });
        if (!ok) {
            rejected.push(`${selector} (looked right, but the step did not actually work against it)`);
            continue;
        }
        const previous = loadFlows(platform)[step];
        saveFlow(platform, step, selector);
        return { selector, replaced: previous ?? '' };
    }
    return { blocked: intent.blocker, rejected };
}
//# sourceMappingURL=flows.js.map