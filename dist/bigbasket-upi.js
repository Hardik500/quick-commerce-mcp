import { walletFingerprint } from './wallet.js';
import { paymentRoot } from './payment-ui.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** Generating a merchant QR can create a pending transaction. Approval and
 * a durable shared wallet/UPI guard precede the single dispatch. */
export class BigBasketUpiCheckout {
    journalPath;
    armed;
    pending = false;
    constructor(journalPath) {
        this.journalPath = journalPath;
    }
    hasPending() {
        if (this.pending)
            return true;
        if (!this.journalPath)
            return false;
        if (existsSync(`${this.journalPath}.pending`))
            return true;
        if (!existsSync(this.journalPath))
            return false;
        try {
            return JSON.parse(readFileSync(this.journalPath, 'utf8')).status !== 'confirmed';
        }
        catch {
            return true;
        }
    }
    async generateControl(page) {
        const root = await paymentRoot(page);
        const visible = [];
        for (const control of await root.getByRole('button', { name: /^Generate QR Code$/i }).all()) {
            if (await control.isVisible() && await control.isEnabled() && await control.getAttribute('aria-disabled') !== 'true')
                visible.push(control);
        }
        return visible.length === 1 ? visible[0] : undefined;
    }
    async graphics(page) {
        const root = await paymentRoot(page);
        const graphics = [];
        for (const graphic of await root.locator('img[alt*="qr" i], img[src^="data:image/png;base64,"], canvas').all()) {
            if (!await graphic.isVisible())
                continue;
            const box = await graphic.boundingBox();
            if (box && box.width >= 120 && box.height >= 120 && Math.abs(box.width / box.height - 1) < 0.2)
                graphics.push(graphic);
        }
        return graphics;
    }
    async prepare(page, preview) {
        this.armed = undefined;
        if (this.hasPending())
            return { success: false, message: 'An earlier payment is unresolved. Reconcile it in the app before starting another payment.' };
        if (!Number.isFinite(preview.cart.total) || preview.cart.total <= 0 || !preview.address || !preview.cart.items.length ||
            !await this.generateControl(page) || (await this.graphics(page)).length > 0)
            return { success: false, message: 'No unique enabled BigBasket Generate QR Code control or complete checkout found. No payment attempted.' };
        this.armed = walletFingerprint(preview);
        return { success: false, ready: true, total: preview.cart.total, submitted: false,
            message: 'BigBasket UPI uses a QR scanned with any UPI app. No phone number or UPI ID is required. Generating it requires explicit approval and may create a pending transaction.' };
    }
    async submit(page, preview) {
        const armed = this.armed;
        this.armed = undefined;
        if (!armed || this.hasPending() || armed !== walletFingerprint(preview))
            return { success: false, submitted: false,
                message: 'QR approval is missing, used, or the cart/address/amount changed. No payment attempted.' };
        const control = await this.generateControl(page);
        if (!control || (await this.graphics(page)).length > 0)
            return { success: false, submitted: false, message: 'QR generation control is absent, disabled or ambiguous. No payment attempted.' };
        try {
            if (this.journalPath) {
                mkdirSync(dirname(this.journalPath), { recursive: true, mode: 0o700 });
                writeFileSync(`${this.journalPath}.pending`, 'pending', { flag: 'wx', mode: 0o600 });
                writeFileSync(this.journalPath, JSON.stringify({ status: 'pending', method: 'upi_qr', updatedAt: new Date().toISOString() }), { mode: 0o600 });
            }
            this.pending = true;
        }
        catch {
            return { success: false, submitted: false, message: 'Could not persist payment attempt tracking. No QR was generated.' };
        }
        try {
            await control.click({ timeout: 5000 });
            const root = await paymentRoot(page);
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const graphics = await this.graphics(page);
                if (graphics.length === 1) {
                    const image = await graphics[0].screenshot({ type: 'png', scale: 'css', timeout: 5000 });
                    const text = await root.locator('body').innerText();
                    const expiry = text.split('\n').find(line => /(?:expire|valid for|remaining)/i.test(line)) ?? '';
                    return { success: true, submitted: true, status: 'pending', total: preview.cart.total, image,
                        message: `BigBasket UPI QR is ready for ₹${preview.cart.total}. Scan it with any UPI app. ${expiry} Payment and order completion are not confirmed. Do not generate another QR or switch methods until this attempt is reconciled.` };
                }
                await page.waitForTimeout(200);
            }
        }
        catch { /* A lost response can follow a successful transaction dispatch. */ }
        return { success: false, submitted: true, status: 'unknown', message: 'QR generation was attempted but no unique QR image was observed. Inspect the app/payment history; do not retry or switch methods.' };
    }
}
//# sourceMappingURL=bigbasket-upi.js.map