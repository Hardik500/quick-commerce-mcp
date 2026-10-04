import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { validateUpiQr } from './upi-qr.js';
const payload = 'upi://pay?pa=fixture@bank&pn=BIGBASKET&am=162.59&cu=INR&tr=fixture-reference';
test('QR PNG decoding validates UPI payee, exact paise, INR and merchant without exposing the VPA/reference', async () => {
  const image = await QRCode.toBuffer(payload, { width: 240 });
  assert.deepEqual(validateUpiQr(image, 162.59, /^BIGBASKET$/), {
    amount: 162.59, currency: 'INR', merchant: 'BIGBASKET', hasReference: true, width: 240, height: 240,
  });
});
test('wrong amount/currency/merchant, duplicate parameters, URL QR and undecodable images cannot be returned as ready', async () => {
  for (const invalid of [payload.replace('162.59', '162.58'), payload.replace('INR', 'USD'),
    payload.replace('BIGBASKET', 'OTHER'), payload + '&am=162.59', payload.replace('fixture@bank', ''), 'https://example.com/pay']) {
    const image = await QRCode.toBuffer(invalid);
    assert.throws(() => validateUpiQr(image, 162.59, /^BIGBASKET$/));
  }
  assert.throws(() => validateUpiQr(Buffer.from('not an image'), 162.59));
  assert.throws(() => validateUpiQr(imageForPlaceholder, NaN));
});
const imageForPlaceholder = Buffer.from('not an image');
