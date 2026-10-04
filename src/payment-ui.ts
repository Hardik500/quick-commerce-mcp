import type { Page, Frame, Locator } from 'playwright';
import { paymentMethod, paymentOptions, planPayment, type PaymentPlan, type PaymentPreferences, type PaymentOption } from './payments.js';

export async function paymentRoot(page: Page): Promise<Page | Frame> {
  const frame = page.locator('iframe[name="HyperServices"], iframe[src*="zpaykit"]').first();
  if (await frame.isVisible().catch(() => false)) {
    const content = await (await frame.elementHandle())?.contentFrame();
    if (content) return content;
  }
  return page;
}

export async function inspectPayments(page: Page, platform: string, labels: string[]): Promise<PaymentOption[]> {
  const root = await paymentRoot(page);
  const observed: Array<{ label: string; enabled: boolean }> = [];
  // Plain labels remain hints. Interactive controls supply actual disabled state.
  for (const element of await root.locator('[role="tab"], [role="button"], button, h5').all()) {
    if (!(await element.isVisible())) continue;
    const label = (await element.getAttribute('aria-label')) || (await element.innerText()).trim();
    if (!label || label.length > 100) continue;
    observed.push({ label, enabled: await element.isEnabled() && (await element.getAttribute('aria-disabled')) !== 'true' });
  }
  // An enabled text hint must not override an explicitly disabled category.
  const disabled = new Set(observed.filter(o => !o.enabled).map(o => paymentMethod(o.label)).filter(m =>
    m && !observed.some(o => o.enabled && paymentMethod(o.label) === m)));
  return paymentOptions(platform, [...labels.filter(l => !disabled.has(paymentMethod(l))), ...observed]);
}

export interface PaymentPreparation { plan: PaymentPlan; opened: boolean; message: string }

export async function preparePaymentPanel(page: Page, platform: string, labels: string[], prefs: PaymentPreferences,
  optionId?: string): Promise<PaymentPreparation> {
  const options = await inspectPayments(page, platform, labels);
  let plan = planPayment(options, prefs);
  if (optionId) {
    const option = options.find(o => o.id === optionId && o.enabled);
    if (!option) throw new Error('Payment option is absent or disabled. Inspect current options again.');
    plan = planPayment([option], { ...prefs, order: [option.method] });
  }
  const selected = plan.selected;
  if (!selected) return { plan, opened: false, message: plan.message };
  const root = await paymentRoot(page);
  // Open tabs/headings or an exact, known category button. Provider/COD
  // buttons can submit transactions and are deliberately excluded.
  const controls = root.getByRole('tab', { name: selected.label, exact: true })
    .or(root.locator('h5').filter({ hasText: new RegExp(`^${escapeRegex(selected.label)}$`, 'i') }))
    .or(root.getByRole('button', { name: /^(?:UPI|Pay by UPI|Wallets?|Cards?|Credit\/Debit Card|Netbanking|Net Banking)$/i })
      .filter({ hasText: new RegExp(`^${escapeRegex(selected.label)}$`, 'i') }));
  // BigBasket's Juspay category labels are article[role=none] inside the
  // hosted payment frame. Exact allowlisted category names cannot submit a
  // provider payment or a pay-on-delivery order.
  const nativeCategory = platform === 'bigbasket' && root !== page &&
    /^(?:UPI|Wallets?|Credit\s*\/\s*Debit Card|Netbanking)$/i.test(selected.label)
    ? root.locator('article[role="none"]').filter({ hasText: new RegExp(`^${escapeRegex(selected.label)}$`, 'i') })
    : undefined;
  const visible: Locator[] = [];
  for (const control of await (nativeCategory ? controls.or(nativeCategory) : controls).all()) if (await control.isVisible() && await control.isEnabled() &&
    await control.getAttribute('aria-disabled') !== 'true') visible.push(control);
  if (visible.length !== 1) return { plan, opened: false,
    message: 'No unique safe category control was found. Choose the option in the app; no payment was attempted.' };
  await visible[0].click();
  // Wait for an observable panel change instead of assuming click completion
  // means its asynchronously rendered options are already available.
  await root.locator('body').evaluate(() => new Promise<void>(resolve => {
    const timer = setTimeout(done, 1500);
    const observer = new MutationObserver(done);
    function done() { clearTimeout(timer); observer.disconnect(); resolve(); }
    observer.observe(document.body, { childList: true, subtree: true });
  }));
  // Sub-options may render asynchronously. Observe their text without submitting.
  await root.locator('body').waitFor();
  const text = await root.locator('body').innerText();
  const details = text.split('\n').map(l => l.trim()).filter(l =>
    /^(?:.*UPI ID.*|.*QR.*|.*scan.*pay.*|.*collect.*|.*wallet.*|Amazon Pay|Mobikwik)$/i.test(l) && l.length < 100);
  const updated = await inspectPayments(page, platform, [...labels, ...details]);
  plan = planPayment(updated, { ...prefs, ...(optionId ? { order: [selected.method] } : {}) });
  return { plan, opened: true, message: 'Payment category opened. No collect request, QR transaction, wallet debit, card authorization or order was submitted.' };
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
