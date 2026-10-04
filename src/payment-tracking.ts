import type { Page } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PaymentObservation {
  status: 'confirmed' | 'failed' | 'cancelled' | 'pending' | 'unknown';
  orderId?: string; paymentStatus: 'paid' | 'failed' | 'pending' | 'unknown'; message: string;
}
const hosts: Record<string, string[]> = { bigbasket: ['bigbasket.com'], blinkit: ['blinkit.com'],
  zepto: ['zepto.com', 'zeptonow.com'], swiggy: ['swiggy.com'], 'swiggy-instamart': ['swiggy.com'] };
function merchantUrl(platform: string, value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && (hosts[platform] ?? []).some(h => u.hostname === h || u.hostname.endsWith('.' + h)); }
  catch { return false; }
}
export function orderIdentity(url: string, text: string): string | undefined {
  let path = '';
  try { path = new URL(url).pathname; } catch { /* fixture or unknown URL */ }
  const fromPath = (path.match(/\/(?:track-order|order-tracking)\/([A-Za-z0-9-]{4,})(?:\/|$)/) ??
    path.match(/\/(?:orders?|order-details)\/([A-Za-z0-9-]{4,})(?:\/|$)/))?.[1];
  return fromPath && !/^(?:history|details|tracking|track-order|summary|status)$/i.test(fromPath) ? fromPath :
    text.match(/order\s*(?:id|number|no\.?)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i)?.[1];
}
export function classifyOrder(text: string): Omit<PaymentObservation, 'orderId'> {
  const cancelled = /(?:your\s+)?order\s+(?:has been\s+|is\s+)?cancelled|order cancellation confirmed/i.test(text);
  const failed = /(?:your\s+)?payment\s+(?:has\s+)?failed|payment unsuccessful|transaction declined/i.test(text);
  const pending = /payment pending|awaiting payment|complete (?:your )?payment|scan QR and pay|approve payment within/i.test(text);
  const accepted = /order (?:confirmed|placed successfully)|thank you for (?:your )?order|order has been delivered|out for delivery|preparing your order|order dispatched/i.test(text);
  const paid = /payment (?:successful|received|completed)|paid (?:successfully|via|using)|amount paid/i.test(text);
  if (cancelled) return { status: 'cancelled', paymentStatus: failed ? 'failed' : 'unknown', message: 'Merchant reports this order cancelled. No retry or fallback was attempted.' };
  if (failed && (accepted || paid)) return { status: 'unknown', paymentStatus: 'unknown', message: 'Conflicting merchant payment/order evidence; inspect the order before proceeding.' };
  if (failed) return { status: 'failed', paymentStatus: 'failed', message: 'Merchant reports this payment failed. No retry or fallback was attempted.' };
  if (pending) return { status: 'pending', paymentStatus: 'pending', message: 'Payment remains pending; complete payment in your UPI/bank app. No additional transaction was created.' };
  if (accepted) return { status: 'confirmed', paymentStatus: paid ? 'paid' : 'unknown', message: 'Merchant confirms this order. Payment is marked paid only when explicitly shown.' };
  return { status: 'unknown', paymentStatus: paid ? 'paid' : 'unknown', message: 'No definitive merchant order outcome is visible yet.' };
}
interface Attempt { platform: string; method: string; total: number; createdAt: string; baselineIds: string[]; orderId?: string; outcome?: PaymentObservation }
export class PaymentTracker {
  constructor(private path: string, private guardPath?: string) {}
  private save(attempt: Attempt) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path + '.tmp', JSON.stringify(attempt), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
  }
  private read(): Attempt | undefined {
    if (!existsSync(this.path)) return undefined;
    return JSON.parse(readFileSync(this.path, 'utf8'));
  }
  async begin(platform: string, method: string, total: number, pages: Page[]) {
    if (!Number.isFinite(total) || total <= 0 || !hosts[platform]) throw new Error('A supported platform and positive approved total are required.');
    const previous = this.read();
    if (previous && !['confirmed', 'failed', 'cancelled'].includes(previous.outcome?.status ?? 'pending')) throw new Error('An earlier tracked payment is unresolved. Check get_payment_status before another payment attempt.');
    const baselineIds: string[] = [];
    for (const page of pages) if (merchantUrl(platform, page.url())) {
      const id = orderIdentity(page.url(), await page.locator('body').innerText().catch(() => ''));
      if (id) baselineIds.push(id);
    }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path + '.pending', 'pending', { flag: 'wx', mode: 0o600 });
    this.save({ platform, method, total, createdAt: new Date().toISOString(), baselineIds });
  }
  abandonUnsubmitted() {
    const attempt = this.read();
    if (attempt) { attempt.outcome = { status: 'failed', paymentStatus: 'unknown', message: 'Adapter explicitly reports that no payment was submitted.' }; this.save(attempt); rmSync(this.path + '.pending', { force: true }); }
  }
  async inspect(pages: Page[] | (() => Page[]), waitMs = 0): Promise<PaymentObservation> {
    const attempt = this.read();
    if (!attempt) return { status: 'unknown', paymentStatus: 'unknown', message: 'No tracked payment attempt. No payment/order action was taken.' };
    if (attempt.outcome && ['confirmed', 'failed', 'cancelled'].includes(attempt.outcome.status)) return attempt.outcome;
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 30000);
    do {
      const observations: PaymentObservation[] = [];
      for (const page of typeof pages === 'function' ? pages() : pages) {
        if (page.isClosed() || !merchantUrl(attempt.platform, page.url())) continue;
        if (/\/(?:orders|order-history|history)\/?$/.test(new URL(page.url()).pathname)) continue;
        const text = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
        const orderId = orderIdentity(page.url(), text);
        if (!orderId || attempt.baselineIds.includes(orderId) || (attempt.orderId && orderId !== attempt.orderId)) continue;
        const totals = [...text.matchAll(/(?:total(?: amount payable)?|to pay|amount paid|retry payment)\s*[:|]?\s*₹\s*([\d,]+(?:\.\d{1,2})?)/gi)].map(m => Math.round(Number(m[1].replace(/,/g, '')) * 100));
        if (totals.length && !totals.includes(Math.round(attempt.total * 100))) continue;
        // URL/order ID proves identity, never successful payment by itself.
        observations.push({ orderId, ...classifyOrder(text) });
      }
      if (observations.length === 1) {
        const observation = observations[0];
        attempt.orderId = observation.orderId;
        if (['confirmed', 'failed', 'cancelled'].includes(observation.status)) {
          attempt.outcome = observation;
          this.save(attempt);
          rmSync(this.path + '.pending', { force: true });
          try { this.reconcileGuard(attempt); } catch { observation.message += ' Attempt guard could not be reconciled; it remains protected.'; }
          return observation;
        }
        this.save(attempt);
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() <= deadline);
    return { status: 'pending', paymentStatus: 'unknown', orderId: attempt.orderId,
      message: 'No unique terminal outcome for this payment yet. Keep watching with get_payment_status; no retry, navigation or fallback was attempted.' };
  }
  private reconcileGuard(attempt: Attempt) {
    if (!this.guardPath || !existsSync(this.guardPath)) return;
    const record = JSON.parse(readFileSync(this.guardPath, 'utf8'));
    if (record.status !== 'pending' || Date.parse(record.updatedAt) < Date.parse(attempt.createdAt) ||
      (record.method && record.method !== attempt.method)) return;
    // Preserve an audit copy before releasing the guard for a terminal merchant outcome.
    const archive = this.guardPath + '.' + Date.now() + '.resolved';
    writeFileSync(archive, JSON.stringify({ ...record, resolution: attempt.outcome }), { mode: 0o600, flag: 'wx' });
    rmSync(this.guardPath);
    rmSync(this.guardPath + '.pending', { force: true });
  }
}
