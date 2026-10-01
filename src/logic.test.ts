import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitPrice, relevant, rankByUnitPrice } from './ranking.js';
import { BlinkitPlatform } from './platforms/blinkit.js';
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
