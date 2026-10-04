export const PAYMENT_METHODS = ['upi_collect', 'upi_qr', 'wallet', 'card', 'cod', 'netbanking', 'pay_later', 'pluxee'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaymentPreference = PaymentMethod | 'upi';
export interface PaymentPreferences {
  order?: PaymentPreference[];
  /** Fallback only when a method is absent/disabled, never after submission. */
  allow_fallback?: boolean;
  upi_id?: string;
  wallet_provider?: string;
  card_last4?: string;
}
export const DEFAULT_PAYMENT_ORDER: PaymentPreference[] = ['upi_collect', 'upi_qr', 'wallet', 'card', 'cod'];
export const EXECUTABLE_PAYMENTS: Record<string, PaymentMethod[]> = {
  blinkit: ['upi_collect', 'card', 'cod'], zepto: ['upi_qr', 'card', 'cod'],
  'swiggy-instamart': ['cod'], swiggy: ['cod'], bigbasket: ['upi_qr'],
};
export interface PaymentOption {
  id: string;
  method: PaymentPreference;
  label: string;
  enabled: boolean;
  execution: 'adapter' | 'manual';
  /** Native or linked prepaid credit with an observed checkout balance. */
  balanceVerifiedWallet?: boolean;
}
export interface PaymentPlan {
  preferenceOrder: PaymentPreference[];
  options: PaymentOption[];
  selected?: PaymentOption;
  missing: string[];
  status: 'ready_to_prepare' | 'needs_details' | 'inspect_upi' | 'unavailable';
  message: string;
}

export function validatePaymentPreferences(value: unknown): asserts value is PaymentPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payment preferences must be an object.');
  const p = value as PaymentPreferences;
  const permitted = new Set(['order', 'allow_fallback', 'upi_id', 'wallet_provider', 'card_last4']);
  if (Object.keys(p).some(k => !permitted.has(k))) throw new Error('Unknown payment preference field. Store no card numbers, CVV or OTP here.');
  if (p.order !== undefined && (!Array.isArray(p.order) || !p.order.length ||
    p.order.some(m => ![...PAYMENT_METHODS, 'upi'].includes(m)) || new Set(p.order).size !== p.order.length)) {
    throw new Error('Payment order must be a nonempty list of unique supported methods.');
  }
  if (p.allow_fallback !== undefined && typeof p.allow_fallback !== 'boolean') throw new Error('allow_fallback must be boolean.');
  if (p.upi_id !== undefined && (typeof p.upi_id !== 'string' || !/^[\w.-]{2,}@[\w.-]{2,}$/.test(p.upi_id))) throw new Error('Invalid UPI ID.');
  if (p.card_last4 !== undefined && (typeof p.card_last4 !== 'string' || !/^\d{4}$/.test(p.card_last4))) throw new Error('card_last4 must be four digits.');
  if (p.wallet_provider !== undefined && (typeof p.wallet_provider !== 'string' || !p.wallet_provider.trim() || p.wallet_provider.length > 80)) throw new Error('Choose a wallet provider by name.');
}

export function paymentMethod(label: string): PaymentPreference | undefined {
  if (/not available|unavailable|not eligible|disabled/i.test(label)) return undefined;
  if (/QR|scan.*pay/i.test(label)) return 'upi_qr';
  if (/UPI ID|VPA|collect|add.*UPI/i.test(label)) return 'upi_collect';
  if (/wallet/i.test(label)) return 'wallet';
  if (/UPI|Google Pay|GPay|PhonePe|BHIM|Navi/i.test(label)) return 'upi';
  if (/cash|pay on delivery/i.test(label)) return 'cod';
  if (/pluxee|sodexo/i.test(label)) return 'pluxee';
  if (/pay later|lazypay|simpl/i.test(label)) return 'pay_later';
  if (/net\s*banking/i.test(label)) return 'netbanking';
  if (/wallet|Amazon Pay|Mobikwik/i.test(label)) return 'wallet';
  if (/card|credit.*debit/i.test(label)) return 'card';
  return undefined;
}

export function paymentOptions(platform: string, labels: Array<string | { label: string; enabled: boolean }>): PaymentOption[] {
  const unique = new Map<string, PaymentOption>();
  for (const raw of labels) {
    const label = typeof raw === 'string' ? raw : raw.label;
    const method = paymentMethod(label);
    if (!method) continue;
    const id = `${method}:${label.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    unique.set(id, { id, method, label, enabled: typeof raw === 'string' || raw.enabled,
      execution: method !== 'upi' && !/add.*card|new.*card/i.test(label) &&
        (EXECUTABLE_PAYMENTS[platform] ?? []).includes(method) ? 'adapter' : 'manual' });
  }
  return [...unique.values()];
}

export function planPayment(options: PaymentOption[], prefs: PaymentPreferences = {}): PaymentPlan {
  const order = prefs.order ?? DEFAULT_PAYMENT_ORDER;
  const expanded = order.flatMap(m => m === 'upi' ? ['upi_collect', 'upi_qr'] as PaymentMethod[] : [m]);
  const candidates = prefs.allow_fallback === false ? expanded.slice(0, order[0] === 'upi' ? 2 : 1) : expanded;
  let selected: PaymentOption | undefined;
  let inspect = false;
  for (const method of candidates) {
    selected = [...options].sort((a, b) => Number(Boolean(b.balanceVerifiedWallet)) - Number(Boolean(a.balanceVerifiedWallet))).find(o => o.enabled && o.method === method &&
      (method !== 'wallet' || !prefs.wallet_provider || /^(wallets?|digital wallets?)$/i.test(o.label) || o.label.toLowerCase().includes(prefs.wallet_provider.toLowerCase())) &&
      (method !== 'card' || !prefs.card_last4 || /^(?:(?:credit|debit|credit\s*\/\s*debit)\s*)?cards?$/i.test(o.label) || o.label.includes(prefs.card_last4)));
    if (selected) break;
    // UPI's category alone proves neither collect nor QR. Inspect before falling back.
    if (method.startsWith('upi') && options.some(o => o.enabled && o.method === 'upi') &&
      !options.some(o => o.enabled && (o.method === 'upi_collect' || o.method === 'upi_qr'))) {
      selected = options.find(o => o.enabled && o.method === 'upi' && /^(?:pay (?:by|via) )?upi$/i.test(o.label)) ??
        options.find(o => o.enabled && o.method === 'upi'); inspect = true; break;
    }
  }
  const missing: string[] = [];
  if (selected?.method === 'upi_collect' && !prefs.upi_id) missing.push('upi_id');
  if (selected?.method === 'wallet' && !selected.balanceVerifiedWallet && !prefs.wallet_provider) missing.push('wallet_provider');
  if (selected?.method === 'card' && !prefs.card_last4) missing.push('card_last4_or_new_card_in_app');
  if (selected?.method === 'netbanking') missing.push('bank_in_app');
  const status = !selected ? 'unavailable' : inspect ? 'inspect_upi' : missing.length ? 'needs_details' : 'ready_to_prepare';
  return { preferenceOrder: order, options, selected, missing, status,
    message: !selected ? 'No enabled option matches the payment preferences. Ask the user to choose; no payment attempted.' :
      inspect ? 'Open UPI to inspect collect/QR availability before choosing a fallback.' :
      missing.length ? `Ask for ${missing.join(', ')} before preparing payment.` :
      `${selected.label} selected for preparation. ${selected.execution === 'manual' ? 'Complete this flow in the app; adapter execution is not yet verified.' : 'Explicit order approval is still required.'}` };
}
