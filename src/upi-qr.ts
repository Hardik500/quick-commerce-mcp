import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/** Decode only local PNG screenshots; never follow URLs from a QR payload. */
export function validateUpiQr(image: Buffer, total: number, merchant?: RegExp) {
  if (!Number.isFinite(total) || total <= 0 || image.length < 24 || image.length > 2_000_000 ||
    !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    image.readUInt32BE(16) > 2048 || image.readUInt32BE(20) > 2048) throw new Error('Invalid QR screenshot.');
  const png = PNG.sync.read(image);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!decoded) throw new Error('QR image is not decodable.');
  let uri: URL;
  try { uri = new URL(decoded.data); } catch { throw new Error('QR is not a UPI payment URI.'); }
  const params = uri.searchParams;
  const amount = params.get('am') ?? '';
  const name = params.get('pn') ?? '';
  if (uri.protocol !== 'upi:' || uri.hostname !== 'pay' || !['', '/'].includes(uri.pathname) ||
    ['pa', 'pn', 'am', 'cu'].some(key => params.getAll(key).length !== 1) ||
    !/^[\w.+-]+@[\w.-]+$/.test(params.get('pa') ?? '') || !name ||
    !/^\d+(?:\.\d{1,2})?$/.test(amount) || params.get('cu') !== 'INR' ||
    Math.round(Number(amount) * 100) !== Math.round(total * 100) || (merchant && !merchant.test(name))) {
    throw new Error('QR payment details do not match the approved amount, currency or merchant.');
  }
  return { amount: Number(amount), currency: 'INR', merchant: name,
    hasReference: Boolean(params.get('tr') || params.get('tid')), width: png.width, height: png.height };
}
