import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitPrice, relevant, rankByUnitPrice, resolveItem, validateCart } from './ranking.js';
import { BlinkitPlatform, parseBill } from './platforms/blinkit.js';
import { parseZeptoBill } from './platforms/zepto.js';
import { parseInstamartBill } from './platforms/swiggy-instamart.js';
import type { Product } from './platforms/base.js';

const prod = (o: Partial<Product>): Product =>
  ({ id: '1', name: 'Amul Milk', price: 30, quantity: '500 ml', inStock: true, platform: 'blinkit', ...o });

// Protected helpers are reachable through any concrete platform (constructor does no I/O).
const platform = new BlinkitPlatform() as any;

test('parsePrice', () => {
  assert.equal(platform.parsePrice('₹45'), 45);
  assert.equal(platform.parsePrice('Rs. 45.50'), 45.5);
  assert.equal(platform.parsePrice('45.00'), 45);
  assert.equal(platform.parsePrice('free'), 0);
});

test('unitPrice normalises pack sizes', () => {
  assert.deepEqual(unitPrice(prod({ price: 30, quantity: '500 ml' })), { value: 6, label: '100 ml' });
  assert.deepEqual(unitPrice(prod({ price: 90, quantity: '1 L' })), { value: 9, label: '100 ml' });
  assert.deepEqual(unitPrice(prod({ price: 100, quantity: '2 x 500 g' })), { value: 10, label: '100 g' });
  assert.deepEqual(unitPrice(prod({ price: 60, quantity: '6 pcs' })), { value: 10, label: 'pc' });
  assert.deepEqual(unitPrice(prod({ price: 25, quantity: 'big' })), { value: 25, label: 'pack' });
});

test('relevant drops out-of-stock and non-matching products', () => {
  const list = [
    prod({ id: 'a', name: 'Amul Taaza Toned Milk' }),
    prod({ id: 'b', name: 'Amul Taaza Toned Milk', inStock: false }),
    prod({ id: 'c', name: 'Amul Butter' }),
  ];
  assert.deepEqual(relevant('amul milks', list).map(p => p.id), ['a']);
});

test('rankByUnitPrice sorts cheapest first within the most common unit', () => {
  const ranked = rankByUnitPrice([
    prod({ id: 'big', price: 90, quantity: '1 L' }),       // 9 / 100 ml
    prod({ id: 'small', price: 17, quantity: '200 ml' }),  // 8.5 / 100 ml
    prod({ id: 'odd', price: 5, quantity: '6 pcs' }),      // different unit, excluded
  ]);
  assert.deepEqual(ranked.map(x => x.p.id), ['small', 'big']);
  assert.deepEqual(rankByUnitPrice([]), []);
});

test('scanPaymentMethods', () => {
  const found: string[] = platform.scanPaymentMethods('Google Pay\nUPI\nHsbc Mastercard Card\n****** 8023\nCash on Delivery');
  assert.deepEqual(found.sort(), ['Cash on Delivery', 'Google Pay', 'Hsbc Mastercard Card ••8023', 'UPI'].sort());
  const unavailable: string[] = platform.scanPaymentMethods('Cash on delivery is not available for orders below ₹50\nPhonePe');
  assert.deepEqual(unavailable, ['PhonePe']);
});

test("resolveItem: match, synonym, out-of-stock and alternatives", () => {
  const ps = [prod({ id: "a", name: "Coca-Cola Zero Sugar", quantity: "300 ml", price: 40 }), prod({ id: "b", name: "Amul High Protein Paneer", quantity: "200 g", price: 120, inStock: false }), prod({ id: "c", name: "Amul Fresh Paneer", quantity: "200 g", price: 90 })];
  const coke = resolveItem("coke zero", ps);
  assert.equal(coke.status, "match"); assert.equal(coke.options[0].id, "a");
  const pan = resolveItem("high protein paneer", ps);
  assert.equal(pan.status, "alternatives"); assert.equal(pan.outOfStock, true); assert.equal(pan.options[0].id, "c");
  assert.equal(resolveItem("xyz", ps).status, "none");
});

test("parseBill: discounted items total and unknown charges", () => {
  const b = parseBill(["Bill details", "Items total Saved ₹2 ₹195 ₹193", "Delivery charge ₹30", "Handling charge ₹12", "Late night convenience charge ₹15", "Grand total ₹250"]);
  assert.equal(b.subtotal, 193); assert.equal(b.total, 250);
  assert.deepEqual(b.fees.map(f => f.amount), [30, 12, 15]);
});

test("validateCart: missing, qty mismatch, bill reconcile", () => {
  const cart = { items: [{ name: "Coke", cartQuantity: 1 }], subtotal: 38, total: 80, fees: [{ amount: 30 }, { amount: 12 }] };
  const v = validateCart([{ name: "coke", quantity: 2 }, { name: "Paneer", quantity: 1 }], cart);
  assert.deepEqual(v.missing, ["Paneer"]); assert.equal(v.wrongQty.length, 1); assert.equal(v.billOk, true);
  assert.equal(validateCart([], { ...cart, total: 99 }).billOk, false);
});

test("parseZeptoBill: waived fees are 0, savings rows ignored", () => {
  const b = parseZeptoBill(["Yay! You saved ₹47 on this order", "Item Total ₹125 ₹123", "Delivery Fee ₹30", "Handling Fee ₹10 FREE", "Late Night Fee ₹35 FREE", "To Pay ₹200 ₹153", "Discount on MRP ₹2", "Savings on Handling fee ₹10"]);
  assert.equal(b.subtotal, 123); assert.equal(b.total, 153);
  assert.deepEqual(b.fees, [{ label: "Delivery Fee", amount: 30 }]);
});

test("parseInstamartBill: struck originals, FREE and rounding", () => {
  const b = parseInstamartBill(["x", "BILL DETAILS", "Item Total", "₹121.00", "₹120.00", "Handling Fee", "₹12.83", "₹12.00", "Delivery Partner Fee", "₹30.00", "FREE", "Late Night Fee", "₹9.00", "₹5.00", "GST and Charges", "₹0.90", "To Pay", "₹173.73", "₹138", "tail"]);
  assert.equal(b.subtotal, 120); assert.equal(b.total, 138);
  assert.deepEqual(b.fees.map(f => f.amount), [12, 5, 0.9]);
});
