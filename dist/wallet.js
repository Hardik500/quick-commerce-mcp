import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
const NATIVE_WALLETS = {
    bigbasket: /^(?:Use )?bbWallet$/i,
    blinkit: /^Blinkit (?:Wallet|Money)$/i,
    zepto: /^Zepto (?:Cash|Wallet)$/i,
    swiggy: /^Swiggy Money$/i,
    'swiggy-instamart': /^Swiggy Money$/i,
};
const paise = (amount) => Math.round(amount * 100);
const money = (value) => Number(value.replace(/,/g, ''));
export function walletFingerprint(preview) {
    return createHash('sha256').update(JSON.stringify({
        address: preview.address, total: paise(preview.cart.total),
        items: preview.cart.items.map(i => [i.id, i.name, i.cartQuantity, paise(i.price)]).sort(),
    })).digest('hex');
}
/** Only a native or linked wallet with an observable selector and explicit balance.
 * Provider buttons can create transactions, so discovery never clicks them. */
async function findWallet(page, platform, provider) {
    const nativeLabel = NATIVE_WALLETS[platform];
    if (!nativeLabel)
        return undefined;
    const label = provider ? new RegExp(`^(?:Use )?${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') :
        new RegExp(`${nativeLabel.source}|^(?:Amazon Pay|Paytm|MobiKwik|Freecharge|Airtel Money|PayZapp|JioMoney|OlaMoney)$`, 'i');
    const found = [];
    for (const root of page.frames()) {
        for (const heading of await root.getByText(label, { exact: true }).all()) {
            if (!await heading.isVisible())
                continue;
            let row = heading;
            for (let depth = 0; depth < 4; depth++) {
                row = row.locator('..');
                const text = await row.innerText();
                if (text.length > 400)
                    break;
                const balance = text.match(/(?:available\s+)?balance\s*:?\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
                const checkbox = row.locator('input[type="checkbox"], [role="checkbox"], input[type="radio"], [role="radio"]');
                if (!balance || await checkbox.count() !== 1 || !await checkbox.isVisible())
                    continue;
                const name = (await heading.innerText()).replace(/^Use\s+/i, '').trim();
                const native = nativeLabel.test(name);
                // A visible balance plus a selection control is evidence of an
                // available linked account. Link/login/verification actions are manual.
                if (!native && /\b(?:link|login|log in|otp|verify|verification)\b/i.test(text))
                    continue;
                found.push({ row, checkbox, root, provider: name, balance: money(balance[1]), native });
                break;
            }
        }
    }
    if (!provider && found.filter(wallet => wallet.native).length === 1)
        return found.find(wallet => wallet.native);
    return found.length === 1 ? found[0] : undefined;
}
export async function inspectWallet(page, platform, total, provider) {
    if (!Number.isFinite(total) || total <= 0)
        return { total, status: 'unavailable', message: 'A positive checkout total is required.' };
    const wallet = await findWallet(page, platform, provider);
    if (!wallet)
        return { total, status: 'manual', message: 'No unique available wallet balance and selection control found. Open Wallets and choose a linked provider; authentication/linking remains manual.' };
    if (provider && provider.toLowerCase() !== wallet.provider.toLowerCase())
        return { total, status: 'manual', message: `Requested wallet is not the observed native ${wallet.provider}; choose it in the app.` };
    const shortfall = Math.max(0, paise(total) - paise(wallet.balance)) / 100;
    const status = shortfall > 0 ? 'insufficient_balance' : await wallet.checkbox.isEnabled() ? 'ready' : 'unavailable';
    return { provider: wallet.provider, balance: wallet.balance, total, shortfall, status,
        message: status === 'ready' ? 'Wallet covers the full bill. Explicit order approval is required before applying it and submitting; provider authentication can still be required.' :
            status === 'insufficient_balance' ? 'Wallet cannot cover the full bill. No top-up, split payment or fallback was attempted.' : 'Wallet control is disabled.' };
}
export async function inspectWallets(page, platform, total) {
    const providers = new Set();
    const native = NATIVE_WALLETS[platform];
    if (!native)
        return [];
    const labels = new RegExp(`${native.source}|^(?:Amazon Pay|Paytm|MobiKwik|Freecharge|Airtel Money|PayZapp|JioMoney|OlaMoney)$`, 'i');
    for (const root of page.frames())
        for (const heading of await root.getByText(labels, { exact: true }).all()) {
            if (await heading.isVisible())
                providers.add((await heading.innerText()).replace(/^Use\s+/i, '').trim());
        }
    const results = [];
    for (const provider of providers)
        results.push({ ...await inspectWallet(page, platform, total, provider), provider });
    return results;
}
export class WalletCheckout {
    journalPath;
    armed;
    pending = false;
    constructor(journalPath) {
        this.journalPath = journalPath;
        this.pending = this.hasPending();
    }
    hasPending() {
        if (this.journalPath && existsSync(`${this.journalPath}.pending`))
            return true;
        if (this.journalPath && existsSync(this.journalPath)) {
            const record = JSON.parse(readFileSync(this.journalPath, 'utf8'));
            if (!['pending', 'confirmed'].includes(record.status))
                throw new Error('Invalid wallet attempt journal; inspect it before making another payment.');
            if (record.status === 'pending')
                return true;
        }
        return this.journalPath ? false : this.pending;
    }
    record(status, orderId) {
        if (!this.journalPath)
            return;
        mkdirSync(dirname(this.journalPath), { recursive: true, mode: 0o700 });
        if (status === 'pending')
            writeFileSync(`${this.journalPath}.pending`, 'pending', { flag: 'wx', mode: 0o600 });
        const temporary = `${this.journalPath}.tmp`;
        writeFileSync(temporary, JSON.stringify({ status, orderId, updatedAt: new Date().toISOString() }), { mode: 0o600 });
        renameSync(temporary, this.journalPath);
        if (status === 'confirmed')
            rmSync(`${this.journalPath}.pending`, { force: true });
    }
    async prepare(page, platform, preview, provider) {
        this.armed = undefined;
        if (this.hasPending())
            return { success: false, ready: false, message: 'An earlier wallet payment has an unresolved outcome. Reconcile order history before preparing another payment; no retry or fallback.' };
        const wallet = await inspectWallet(page, platform, preview.cart.total, provider);
        if (wallet.status !== 'ready')
            return { success: false, ready: false, wallet, message: wallet.message };
        this.armed = { fingerprint: walletFingerprint(preview), provider: wallet.provider, total: preview.cart.total };
        return { success: false, ready: true, total: preview.cart.total, wallet, message: `${wallet.provider} covers the complete bill; no money has been spent.` };
    }
    async submit(page, platform, preview, provider) {
        const armed = this.armed;
        this.armed = undefined;
        if (this.hasPending() || !armed || walletFingerprint(preview) !== armed.fingerprint || (provider && provider.toLowerCase() !== armed.provider.toLowerCase())) {
            return { success: false, submitted: false, message: 'Wallet approval is missing or cart/address/total changed. Prepare and approve again.' };
        }
        const status = await inspectWallet(page, platform, armed.total, armed.provider);
        if (status.status !== 'ready')
            return { success: false, submitted: false, wallet: status, message: status.message };
        const wallet = (await findWallet(page, platform, armed.provider));
        const before = await confirmation(page);
        if (before)
            return { success: false, submitted: false, message: 'An existing order confirmation is already visible. No new order attempted.' };
        // Linked-provider selection can itself initiate payment. Treat it as a
        // possible dispatch, journal first, and never perform it during preparation.
        if (!wallet.native) {
            try {
                this.record('pending');
            }
            catch {
                return { success: false, submitted: false, message: 'Could not persist wallet attempt tracking; no wallet selection.' };
            }
            this.pending = true;
        }
        try {
            await wallet.checkbox.check({ timeout: 5000 });
        }
        catch {
            return { success: false, submitted: !wallet.native, status: 'unknown', message: 'Wallet selection outcome is uncertain. Inspect the app and order history before any retry.' };
        }
        const directOrderId = await confirmation(page);
        if (directOrderId) {
            try {
                this.record('confirmed', directOrderId);
                this.pending = false;
            }
            catch { /* preserve pending protection */ }
            return { success: true, submitted: true, status: 'confirmed', orderId: directOrderId, message: `Wallet order confirmed: ${directOrderId}.` };
        }
        // A fully covered order must show both the wallet deduction and zero
        // residual payable. A balance alone does not prove applied credit.
        const covered = async () => {
            try {
                const row = await wallet.row.innerText({ timeout: 500 });
                const applied = [...row.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/g)]
                    .some(m => paise(money(m[1])) === paise(armed.total));
                const body = await page.locator('body').innerText({ timeout: 500 });
                const zero = /(?:to pay|amount payable|payable amount|remaining payable)\s*:?\s*(?:₹|Rs\.?|INR)\s*0(?:\.00)?(?:\s|$)/i.test(body);
                return await wallet.checkbox.isChecked() && applied && zero;
            }
            catch {
                return false;
            }
        };
        const end = Date.now() + 5000;
        while (!await covered() && Date.now() < end)
            await new Promise(resolve => setTimeout(resolve, 100));
        if (!await covered())
            return { success: false, submitted: !wallet.native, status: wallet.native ? undefined : 'unknown', message: 'Wallet credit did not prove full coverage and zero remaining payable. No final payment click; inspect the app and order history before proceeding.' };
        const buttons = [];
        for (const root of page.frames())
            for (const button of await root.getByRole('button', { name: /^(?:Place Order|Confirm Order|Pay Now|Pay ₹\s*0(?:\.00)?)$/i }).all()) {
                if (await button.isVisible() && await button.isEnabled())
                    buttons.push(button);
            }
        if (buttons.length !== 1)
            return { success: false, submitted: !wallet.native, status: wallet.native ? undefined : 'unknown', message: 'No unique final wallet order control found. Inspect the app and order history; no final payment click.' };
        // One dispatch only. A timeout can follow a successful request, so it is
        // never permission to retry or switch payment methods.
        // Persist before dispatch so restarting MCP cannot enable a duplicate
        // payment after a lost response. Unresolved entries require reconciliation.
        if (!this.pending)
            try {
                this.record('pending');
            }
            catch {
                return { success: false, submitted: false, message: 'Could not persist wallet attempt tracking; no final payment click.' };
            }
        this.pending = true;
        try {
            await buttons[0].click({ timeout: 5000 });
        }
        catch {
            return { success: false, submitted: true, status: 'unknown', message: 'Wallet order click outcome is unknown. Check order history; do not retry or switch methods.' };
        }
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const orderId = await confirmation(page);
            if (orderId) {
                try {
                    this.record('confirmed', orderId);
                    this.pending = false;
                }
                catch { /* retain pending guard if journal cannot be updated */ }
                return { success: true, submitted: true, status: 'confirmed', orderId, message: `Wallet order confirmed: ${orderId}.` };
            }
            const text = await page.locator('body').innerText().catch(() => '');
            if (/enter (?:the )?otp|verification code|authenticate|payment failed|payment pending/i.test(text))
                break;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return { success: false, submitted: true, status: 'unknown', message: 'No new order confirmation observed. Payment may require authentication or be pending. Check order history; do not retry or switch methods.' };
    }
}
async function confirmation(page) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (!/order (?:placed|confirmed)|thank you for (?:your )?order/i.test(text))
        return undefined;
    return text.match(/order\s*(?:id|number|no\.?)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i)?.[1];
}
//# sourceMappingURL=wallet.js.map