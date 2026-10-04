import { walletFingerprint } from './wallet.js';
import { paymentRoot } from './payment-ui.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateUpiQr } from './upi-qr.js';
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
    async prepare(page, preview) {
        this.armed = undefined;
        if (this.hasPending())
            return { success: false, message: 'An earlier payment is unresolved. Reconcile it in the app before starting another payment.' };
        if (!Number.isFinite(preview.cart.total) || preview.cart.total <= 0 || !preview.address || !preview.cart.items.length ||
            !await this.generateControl(page) || (await qrGraphics(page)).length > 0)
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
        if (!control || (await qrGraphics(page)).length > 0)
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
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const graphics = await qrGraphics(page);
                if (graphics.length === 1) {
                    let captured;
                    try {
                        captured = await readBigBasketQr(page, preview.cart.total);
                    }
                    catch {
                        await page.waitForTimeout(200); // The QR can render after its image/canvas container.
                        continue;
                    }
                    const { image, expiry } = captured;
                    return { success: true, submitted: true, status: 'pending', total: preview.cart.total, image,
                        message: `BigBasket UPI QR is ready for ₹${preview.cart.total}. Scan it with any UPI app. ${expiry} Payment and order completion are not confirmed. Do not generate another QR or switch methods until this attempt is reconciled.` };
                }
                await page.waitForTimeout(200);
            }
        }
        catch { /* A lost response can follow a successful transaction dispatch. */ }
        return { success: false, submitted: true, status: 'unknown', message: 'QR generation was attempted but no unique decodable QR matching the approved amount/currency/merchant was observed. Inspect the app/payment history; do not retry or switch methods.' };
    }
}
async function qrGraphics(page) {
    const root = await paymentRoot(page);
    const graphics = [];
    for (const graphic of await root.locator('img[alt*="qr" i], img[src^="data:image/"], canvas').all()) {
        if (!await graphic.isVisible())
            continue;
        const box = await graphic.boundingBox();
        if (box && box.width >= 120 && box.height >= 120 && Math.abs(box.width / box.height - 1) < 0.2)
            graphics.push(graphic);
    }
    return graphics;
}
/** Read an already generated QR without clicking, navigating or creating a transaction. */
export async function readBigBasketQr(page, total) {
    const graphics = await qrGraphics(page);
    if (graphics.length !== 1)
        throw new Error('No unique QR graphic found.');
    // Normalize GIF/image pixels directly, avoiding animated-layout screenshot waits.
    const png = await graphics[0].evaluate(element => {
        if (element instanceof HTMLCanvasElement)
            return element.toDataURL('image/png');
        if (!(element instanceof HTMLImageElement) || !element.complete || !element.naturalWidth)
            return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context)
            return undefined;
        context.drawImage(element, 0, 0);
        return canvas.toDataURL('image/png');
    });
    if (!png)
        throw new Error('QR pixels have not loaded.');
    const image = Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
    const details = validateUpiQr(image, total, /^(?:INNOVATIVE RETAIL CONCEPTS PRIVATE LIMITED|BIGBASKET)$/i);
    const root = await paymentRoot(page);
    const lines = (await root.locator('body').innerText()).split('\n').map(line => line.trim()).filter(Boolean);
    const expiryIndex = lines.findIndex(line => /(?:expire|valid for|remaining|approve payment within)/i.test(line));
    const expiry = expiryIndex < 0 ? '' : lines.slice(expiryIndex, expiryIndex + 2).join(' ');
    return { image, expiry, details };
}
//# sourceMappingURL=bigbasket-upi.js.map