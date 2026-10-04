import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentOptions, planPayment, validatePaymentPreferences } from './payments.js';
import { paymentPreferencesFor, savePrefs, loadPrefs } from './preferences.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const platform of ['zepto', 'blinkit', 'swiggy-instamart', 'bigbasket']) {
  test(`${platform}: UPI collect/QR precede wallet, card and COD without claiming unknown execution`, () => {
    const options = paymentOptions(platform, ['Cash on Delivery', 'Credit/Debit Card', 'Wallets', 'Pay via QR Code', 'Enter UPI ID']);
    assert.equal(planPayment(options).selected?.method, 'upi_collect');
    assert.equal(planPayment(options.filter(o => o.method !== 'upi_collect')).selected?.method, 'upi_qr');
    assert.equal(planPayment(options.filter(o => !o.method.startsWith('upi'))).selected?.method, 'wallet');
    assert.equal(options.find(o => o.method === 'upi_collect')?.execution, platform === 'blinkit' ? 'adapter' : 'manual');
    assert.equal(options.find(o => o.method === 'upi_qr')?.execution, ['zepto', 'bigbasket'].includes(platform) ? 'adapter' : 'manual');
  });
}

test('generic UPI is inspected before wallet fallback; known QR resolves generic UPI', () => {
  const options = paymentOptions('bigbasket', ['UPI', 'Wallets']);
  assert.equal(planPayment(options).status, 'inspect_upi');
  assert.equal(planPayment([...options, ...paymentOptions('bigbasket', ['Scan and pay via QR'])]).selected?.method, 'upi_qr');
});

test('Instamart category descriptions keep wallets distinct from their UPI providers', () => {
  const options = paymentOptions('swiggy-instamart', ['Google Pay', 'UPI', 'Wallets. PhonePe, Amazon Pay & more']);
  assert.equal(options[2].method, 'wallet');
  assert.equal(planPayment(options).selected?.label, 'UPI');
});

test('disabled choices are skipped only before submission; strict preference excludes fallback', () => {
  const options = paymentOptions('blinkit', [{ label: 'Enter UPI ID', enabled: false }, 'Wallets', 'Cash on Delivery']);
  assert.equal(planPayment(options).selected?.method, 'wallet');
  assert.equal(planPayment(options, { order: ['upi_collect', 'cod'], allow_fallback: false }).status, 'unavailable');
  assert.equal(planPayment(options, { order: ['cod'] }).selected?.method, 'cod');
  assert.equal(planPayment([]).status, 'unavailable');
});

test('method prerequisites and provider exclusions do not silently switch payment', () => {
  assert.deepEqual(planPayment(paymentOptions('blinkit', ['Enter UPI ID'])).missing, ['upi_id']);
  assert.equal(planPayment(paymentOptions('blinkit', ['Enter UPI ID']), { upi_id: 'person@bank' }).status, 'ready_to_prepare');
  assert.deepEqual(planPayment(paymentOptions('zepto', ['Wallets'])).missing, ['wallet_provider']);
  assert.equal(planPayment(paymentOptions('zepto', ['Amazon Pay', 'Cash on Delivery']), { order: ['wallet'], wallet_provider: 'Mobikwik' }).status, 'unavailable');
  assert.equal(planPayment(paymentOptions('zepto', ['HDFC Card ••1234', 'Cash on Delivery']), { card_last4: '9999', order: ['card', 'cod'] }).selected?.method, 'cod');
  assert.equal(paymentOptions('zepto', ['Add New Card'])[0].execution, 'manual');
  assert.equal(planPayment(paymentOptions('bigbasket', ['Netbanking']), { order: ['netbanking'] }).missing[0], 'bank_in_app');
});

test('global preferences and per-app overrides persist and aliases inherit correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc-payments-'));
  try {
    const file = join(dir, 'prefs.json');
    savePrefs({ payment_preferences: { order: ['wallet', 'upi'], wallet_provider: 'Amazon Pay', allow_fallback: false },
      platform_payment_preferences: { 'swiggy-instamart': { order: ['upi_qr', 'cod'] } } }, file);
    const saved = loadPrefs(file);
    assert.deepEqual(paymentPreferencesFor(saved, 'bigbasket').order, ['wallet', 'upi']);
    assert.deepEqual(paymentPreferencesFor(saved, 'swiggy').order, ['upi_qr', 'cod']);
    assert.equal(paymentPreferencesFor(saved, 'swiggy').wallet_provider, 'Amazon Pay');
    assert.equal(paymentPreferencesFor(saved, 'swiggy').allow_fallback, false);
    assert.deepEqual(paymentPreferencesFor({}, 'blinkit').order, ['upi_collect', 'upi_qr', 'wallet', 'card', 'cod']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('invalid preferences and sensitive card fields are rejected before saving', () => {
  for (const value of [{ order: [] }, { order: ['card', 'card'] }, { order: ['crypto'] }, { card_last4: '123' },
    { upi_id: 'bad' }, { allow_fallback: 'true' }, { cvv: '000' }, { card_number: 'redacted' }, { wallet_provider: '' }]) {
    assert.throws(() => validatePaymentPreferences(value));
  }
  validatePaymentPreferences({ order: ['upi', 'wallet', 'card', 'cod'], card_last4: '1234', upi_id: 'person@bank' });
});
