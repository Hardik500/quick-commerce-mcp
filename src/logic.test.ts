import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitPrice, relevant, rankByUnitPrice, resolveItem, validateCart, storeNotice } from './ranking.js';
import { BlinkitPlatform, parseBill } from './platforms/blinkit.js';
import { parseZeptoBill } from './platforms/zepto.js';
import { parseInstamartBill } from './platforms/swiggy-instamart.js';
import type { Product } from './platforms/base.js';
import { singleFlight } from './single-flight.js';
import { keyedLock } from './keyed-lock.js';

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

test("parseBill: FREE delivery is waived, not charged", () => {
  const b = parseBill(["Items total\nSaved ₹24\n₹325 ₹301", "Delivery charge\n₹30 FREE", "Handling charge\n₹12", "Grand total\n₹313"]);
  assert.deepEqual(b.fees, [{ label: "Handling charge", amount: 12 }]);
  assert.equal(b.subtotal + 12, b.total);
});


test("validateCart: missing, qty mismatch, bill reconcile", () => {
  const cart = { items: [{ name: "Coke", cartQuantity: 1 }], subtotal: 38, total: 80, fees: [{ amount: 30 }, { amount: 12 }] };
  const v = validateCart([{ name: "coke", quantity: 2 }, { name: "Paneer", quantity: 1 }], cart);
  assert.deepEqual(v.missing, ["Paneer"]); assert.equal(v.wrongQty.length, 1); assert.equal(v.billOk, true);
  assert.equal(validateCart([], { ...cart, total: 99 }).billOk, false);
});

test("validateCart: pack size in the wanted name is ignored", () => {
  // Search appends the pack size; the cart page omits it.
  const cart = { items: [{ name: "Coca-Cola Zero Sugar PET - Cola Sparkling Soft Drink", cartQuantity: 1 }], subtotal: 38, total: 38, fees: [] };
  const v = validateCart([{ name: "Coca-Cola Zero Sugar PET - Cola Sparkling Soft Drink (750 ml)", quantity: 1 }], cart);
  assert.deepEqual(v.missing, []);
  assert.deepEqual(v.wrongQty, []);
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

test("resolveItem: brand footer after | does not trigger synonym match", () => {
  const mk = (id: string, name: string) => ({ id, name, price: 38, quantity: "750 ml", inStock: true }) as any;
  const r = resolveItem("coke zero", [mk("1", "Sprite Zero | Lemon-Lime | The Coca-Cola Company"), mk("2", "Coca-Cola Zero Sugar PET| Cola | The Coca-Cola Company")]);
  assert.equal(r.status, "match"); assert.deepEqual(r.options.map(o => o.id), ["2"]);
});

test("singleFlight: concurrent callers share one run and one value", async () => {
  // The shape that broke getPlatform: an awaiting factory called twice in the same
  // tick. A has/set cache starts two runs and hands back two different objects.
  let starts = 0;
  const flight = singleFlight(async (key: string) => {
    starts++;
    await new Promise((r) => setTimeout(r, 5));
    return { key, id: Math.random() };
  });

  const [a, b] = await Promise.all([flight("zepto"), flight("zepto")]);

  assert.equal(starts, 1, "factory must run once for concurrent callers");
  assert.equal(a, b, "both callers must receive the same value");
});

test("singleFlight: different keys run independently", async () => {
  let starts = 0;
  const flight = singleFlight(async (key: string) => { starts++; return key.toUpperCase(); });

  assert.deepEqual(await Promise.all([flight("a"), flight("b"), flight("c")]), ["A", "B", "C"]);
  assert.equal(starts, 3);
});

test("singleFlight: a later call reuses the settled value", async () => {
  let starts = 0;
  const flight = singleFlight(async () => ++starts);

  assert.equal(await flight("k"), 1);
  assert.equal(await flight("k"), 1);
  assert.equal(starts, 1);
  assert.equal(flight.has("k"), true);
});

test("singleFlight: a failure is not cached, so the next call retries", async () => {
  let starts = 0;
  const flight = singleFlight(async () => {
    starts++;
    if (starts === 1) throw new Error("browser would not launch");
    return "ok";
  });

  await assert.rejects(() => flight("zepto"), /would not launch/);
  assert.equal(await flight("zepto"), "ok", "a failed launch must not poison the key");
  assert.equal(starts, 2);
});

test("singleFlight: invalidate forces a fresh run", async () => {
  let starts = 0;
  const flight = singleFlight(async () => ++starts);

  assert.equal(await flight("k"), 1);
  flight.invalidate("k");
  assert.equal(flight.has("k"), false);
  assert.equal(await flight("k"), 2);

  flight.invalidate();
  assert.equal(await flight("k"), 3);
});

test("keyedLock: same key runs one at a time, and sees no overlap", async () => {
  const lock = keyedLock();
  let active = 0, peak = 0;
  const job = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await Promise.all([lock.run(["zepto"], job), lock.run(["zepto"], job), lock.run(["zepto"], job)]);
  assert.equal(peak, 1, "work on one key must never overlap");
});

test("keyedLock: different keys still run in parallel", async () => {
  const lock = keyedLock();
  const order: string[] = [];
  const slow = (name: string) => lock.run([name], async () => {
    order.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, 20));
    order.push(`end:${name}`);
  });
  await Promise.all([slow("zepto"), slow("blinkit")]);
  // Both started before either finished, which is the point.
  assert.equal(order[0].startsWith("start:"), true);
  assert.equal(order[1].startsWith("end:"), false);
});

test("keyedLock: a shared key still serialises a multi-key caller", async () => {
  const lock = keyedLock();
  let active = 0, peak = 0;
  const job = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await Promise.all([
    lock.run(["zepto", "blinkit"], job),
    lock.run(["zepto"], job),
    lock.run(["blinkit", "instamart"], job),
  ]);
  assert.equal(peak, 1, "overlapping key sets must not run concurrently");
});

test("keyedLock: overlapping multi-key callers cannot deadlock", async () => {
  const lock = keyedLock();
  const done = await Promise.all([
    lock.run(["a", "b", "c"], async () => "abc"),
    lock.run(["b", "c"], async () => "bc"),
    lock.run(["c"], async () => "c"),
    lock.run(["a"], async () => "a"),
  ]);
  assert.deepEqual(done, ["abc", "bc", "c", "a"]);
});

test("keyedLock: the key is released even when the job throws", async () => {
  const lock = keyedLock();
  await assert.rejects(() => lock.run(["zepto"], async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await lock.run(["zepto"], async () => "still works"), "still works");
});

test("keyedLock: duplicate keys in one call are held once", async () => {
  const lock = keyedLock();
  let active = 0, peak = 0;
  const job = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await lock.run(["zepto", "zepto", "zepto"], job);
  assert.equal(peak, 1);
});

test("storeNotice: detects closed/unserviceable banners, ignores normal carts", () => {
  assert.match(storeNotice("To Pay\nThis Instamart store is currently unserviceable\nRetry")!, /unserviceable/);
  assert.match(storeNotice("Sorry, store closed for the night")!, /closed/);
  assert.equal(storeNotice("To Pay\n₹138\nProceed to Pay"), undefined);
});
