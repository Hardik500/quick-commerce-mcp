import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitPrice, relevant, rankByUnitPrice, resolveItem, validateCart, storeNotice } from './ranking.js';
import { BlinkitPlatform, parseBill } from './platforms/blinkit.js';
import { parseZeptoBill } from './platforms/zepto.js';
import { parseInstamartBill } from './platforms/swiggy-instamart.js';
import { singleFlight } from './single-flight.js';
import { keyedLock } from './keyed-lock.js';
import { ADD_RUNGS, blockedBy, nextAddAction } from './engine/add-strategy.js';
import { FLOW_STEPS } from './flows.js';
const prod = (o) => ({ id: '1', name: 'Amul Milk', price: 30, quantity: '500 ml', inStock: true, platform: 'blinkit', ...o });
// Protected helpers are reachable through any concrete platform (constructor does no I/O).
const platform = new BlinkitPlatform();
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
        prod({ id: 'big', price: 90, quantity: '1 L' }), // 9 / 100 ml
        prod({ id: 'small', price: 17, quantity: '200 ml' }), // 8.5 / 100 ml
        prod({ id: 'odd', price: 5, quantity: '6 pcs' }), // different unit, excluded
    ]);
    assert.deepEqual(ranked.map(x => x.p.id), ['small', 'big']);
    assert.deepEqual(rankByUnitPrice([]), []);
});
test('scanPaymentMethods', () => {
    const found = platform.scanPaymentMethods('Google Pay\nUPI\nHsbc Mastercard Card\n****** 8023\nCash on Delivery');
    assert.deepEqual(found.sort(), ['Cash on Delivery', 'Google Pay', 'Hsbc Mastercard Card ••8023', 'UPI'].sort());
    const unavailable = platform.scanPaymentMethods('Cash on delivery is not available for orders below ₹50\nPhonePe');
    assert.deepEqual(unavailable, ['PhonePe']);
});
test("resolveItem: match, synonym, out-of-stock and alternatives", () => {
    const ps = [prod({ id: "a", name: "Coca-Cola Zero Sugar", quantity: "300 ml", price: 40 }), prod({ id: "b", name: "Amul High Protein Paneer", quantity: "200 g", price: 120, inStock: false }), prod({ id: "c", name: "Amul Fresh Paneer", quantity: "200 g", price: 90 })];
    const coke = resolveItem("coke zero", ps);
    assert.equal(coke.status, "match");
    assert.equal(coke.options[0].id, "a");
    const pan = resolveItem("high protein paneer", ps);
    assert.equal(pan.status, "alternatives");
    assert.equal(pan.outOfStock, true);
    assert.equal(pan.options[0].id, "c");
    assert.equal(resolveItem("xyz", ps).status, "none");
});
test("parseBill: discounted items total and unknown charges", () => {
    const b = parseBill(["Bill details", "Items total Saved ₹2 ₹195 ₹193", "Delivery charge ₹30", "Handling charge ₹12", "Late night convenience charge ₹15", "Grand total ₹250"]);
    assert.equal(b.subtotal, 193);
    assert.equal(b.total, 250);
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
    assert.deepEqual(v.missing, ["Paneer"]);
    assert.equal(v.wrongQty.length, 1);
    assert.equal(v.billOk, true);
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
    assert.equal(b.subtotal, 123);
    assert.equal(b.total, 153);
    assert.deepEqual(b.fees, [{ label: "Delivery Fee", amount: 30 }]);
});
test("parseInstamartBill: struck originals, FREE and rounding", () => {
    const b = parseInstamartBill(["x", "BILL DETAILS", "Item Total", "₹121.00", "₹120.00", "Handling Fee", "₹12.83", "₹12.00", "Delivery Partner Fee", "₹30.00", "FREE", "Late Night Fee", "₹9.00", "₹5.00", "GST and Charges", "₹0.90", "To Pay", "₹173.73", "₹138", "tail"]);
    assert.equal(b.subtotal, 120);
    assert.equal(b.total, 138);
    assert.deepEqual(b.fees.map(f => f.amount), [12, 5, 0.9]);
});
test("resolveItem: brand footer after | does not trigger synonym match", () => {
    const mk = (id, name) => ({ id, name, price: 38, quantity: "750 ml", inStock: true });
    const r = resolveItem("coke zero", [mk("1", "Sprite Zero | Lemon-Lime | The Coca-Cola Company"), mk("2", "Coca-Cola Zero Sugar PET| Cola | The Coca-Cola Company")]);
    assert.equal(r.status, "match");
    assert.deepEqual(r.options.map(o => o.id), ["2"]);
});
test("singleFlight: concurrent callers share one run and one value", async () => {
    // The shape that broke getPlatform: an awaiting factory called twice in the same
    // tick. A has/set cache starts two runs and hands back two different objects.
    let starts = 0;
    const flight = singleFlight(async (key) => {
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
    const flight = singleFlight(async (key) => { starts++; return key.toUpperCase(); });
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
        if (starts === 1)
            throw new Error("browser would not launch");
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
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
    };
    await Promise.all([lock.run(["zepto"], job), lock.run(["zepto"], job), lock.run(["zepto"], job)]);
    assert.equal(peak, 1, "work on one key must never overlap");
});
test("keyedLock: different keys still run in parallel", async () => {
    const lock = keyedLock();
    const order = [];
    const slow = (name) => lock.run([name], async () => {
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
        active++;
        peak = Math.max(peak, active);
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
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
    };
    await lock.run(["zepto", "zepto", "zepto"], job);
    assert.equal(peak, 1);
});
test("ensureSession: verifies lazily instead of trusting an unset flag", async () => {
    // The Instamart add_to_cart bug, at the unit level: a fresh instance whose
    // flag was never set, on a platform that *is* logged in. A guard reading
    // isLoggedIn directly throws "Not logged in" here; ensureSession must not.
    let checks = 0;
    const p = new BlinkitPlatform();
    p.checkLogin = async () => { checks++; return { loggedIn: true }; };
    assert.equal(p.isLoggedIn, false, "precondition: flag starts unset");
    await p.ensureSession();
    assert.equal(checks, 1);
});
test("ensureSession: a verified session is not re-checked on every call", async () => {
    let checks = 0;
    const p = new BlinkitPlatform();
    p.checkLogin = async () => { checks++; return { loggedIn: true }; };
    await p.ensureSession();
    await p.ensureSession();
    await p.ensureSession();
    assert.equal(checks, 1, "one cookie read per instance, not one per guarded call");
});
test("ensureSession: a genuinely logged-out session still says so", async () => {
    const p = new BlinkitPlatform();
    p.checkLogin = async () => ({ loggedIn: false });
    await assert.rejects(() => p.ensureSession(), /^Error: Not logged in\./);
});
test("ensureSession: indeterminate asks for a retry, not a re-login", async () => {
    const p = new BlinkitPlatform();
    p.checkLogin = async () => ({ loggedIn: false, indeterminate: true, reason: 'bot-detection page' });
    // The distinction that matters: this must NOT read as "Not logged in", or the
    // user is sent into a pointless OTP round trip they cannot fix.
    await assert.rejects(() => p.ensureSession(), /could not confirm/i);
    await assert.rejects(() => p.ensureSession(), /retry/i);
    await assert.rejects(() => p.ensureSession(), (e) => !/Not logged in/.test(e.message));
});
test("ensureSession: a transient failure is not remembered", async () => {
    let n = 0;
    const p = new BlinkitPlatform();
    p.checkLogin = async () => (++n === 1 ? { loggedIn: false, indeterminate: true, reason: 'timeout' } : { loggedIn: true });
    await assert.rejects(() => p.ensureSession(), /timeout/);
    await p.ensureSession(); // must succeed on the retry, not replay the failure
    assert.equal(n, 2);
});
test("storeNotice: detects closed/unserviceable banners, ignores normal carts", () => {
    assert.match(storeNotice("To Pay\nThis Instamart store is currently unserviceable\nRetry"), /unserviceable/);
    assert.match(storeNotice("Sorry, store closed for the night"), /closed/);
    assert.equal(storeNotice("To Pay\n₹138\nProceed to Pay"), undefined);
});
/* ---------------------------------------------------------------------------
 * add-to-cart ladder
 * ------------------------------------------------------------------------- */
const probe = (o = {}) => ({
    landed: false,
    addPresent: true,
    addVisible: true,
    rung: 0,
    scrolled: false,
    waitedForAttach: false,
    ...o,
});
test("addToCart: a card already showing a stepper is never clicked again", () => {
    // The double-add bug. Landing outranks everything, including a visible ADD
    // control, so re-running add on an item already in the cart cannot top it up
    // to two.
    assert.deepEqual(nextAddAction(probe({ landed: true })), { kind: 'already' });
    assert.deepEqual(nextAddAction(probe({ landed: true, rung: 2, addPresent: false })), { kind: 'already' });
});
test("addToCart: a card with no control gets one bounded wait before it is called absent", () => {
    // Virtualised result lists render cards late; giving up on the first miss is
    // how a real product gets reported as unfindable.
    assert.deepEqual(nextAddAction(probe({ addPresent: false })), { kind: 'wait-attach' });
    assert.deepEqual(nextAddAction(probe({ addPresent: false, waitedForAttach: true })), { kind: 'absent' });
});
test("addToCart: a control that is present but off screen is scrolled before any click budget is spent", () => {
    assert.deepEqual(nextAddAction(probe({ addVisible: false })), { kind: 'scroll' });
    // Scrolling did not help, so it stops being retried and the ladder proceeds.
    assert.equal(nextAddAction(probe({ addVisible: false, scrolled: true })).kind, 'click');
});
test("addToCart: the click escalates and only the last rung skips actionability checks", () => {
    // force:true dispatches at the element's coordinates regardless of what the
    // site says about visibility. That is occasionally the only thing that gets
    // through, and it is also the rung most able to click the wrong thing, so it
    // has to be last - and there is no third rung, because a second identical
    // normal click was measured adding ~8s to a blocked card without helping.
    assert.deepEqual(ADD_RUNGS.map(r => r.force), [false, true]);
    assert.deepEqual(nextAddAction(probe({ rung: 0 })), { kind: 'click', ...ADD_RUNGS[0] });
    assert.deepEqual(nextAddAction(probe({ rung: 1 })), { kind: 'click', ...ADD_RUNGS[1] });
    assert.deepEqual(nextAddAction(probe({ rung: ADD_RUNGS.length })), { kind: 'failed' });
});
test("addToCart: the whole ladder is bounded well under the 30s cliff it replaces", () => {
    // Regression guard for the reported failure: one click inheriting Playwright's
    // 30s default, repeated per item, is how a three-item cart took 110s and
    // added nothing. Every rung must now either recover the click or prove the
    // item landed, and the total must stay a small fraction of one old timeout.
    const worstCaseMs = ADD_RUNGS.reduce((n, r) => n + r.timeout, 0);
    assert.ok(worstCaseMs < 15000, `ladder click budget ${worstCaseMs}ms should stay well under one 30s timeout`);
    // Drive it the way addViaCard does, against a card whose control exists but
    // never becomes clickable, and confirm it terminates on a verdict rather
    // than looping.
    let rung = 0;
    let scrolled = false;
    let waitedForAttach = false;
    const clicks = [];
    let verdict = '';
    for (let i = 0; i < 8 && !verdict; i++) {
        const a = nextAddAction(probe({ addVisible: false, rung, scrolled, waitedForAttach }));
        if (a.kind === 'click') {
            clicks.push(String(a.force));
            rung++; // click did not take
        }
        else if (a.kind === 'scroll') {
            scrolled = true;
        }
        else if (a.kind === 'wait-attach') {
            waitedForAttach = true;
        }
        else {
            verdict = a.kind;
        }
    }
    assert.equal(verdict, 'failed');
    // Recovered visibility first, then spent every rung exactly once.
    assert.deepEqual(clicks, ['false', 'true']);
});
test("flow steps: the cart selectors are overridable without a release", () => {
    // The add button, the proof that an add landed, and the increment control
    // all break when a site redeploys. Each needs an override, or the only fix is
    // a code change and an npm release.
    for (const step of ['addToCart', 'cartLanded', 'cartIncrement']) {
        assert.ok(FLOW_STEPS.includes(step), `${step} must be an overridable flow step`);
    }
});
/* ---------------------------------------------------------------------------
 * addViaCard: the ladder driven against a fake card
 * ------------------------------------------------------------------------- */
const LANDED = '[data-testid="landed"]';
const ADD = 'button:has-text("ADD")';
const INC = 'button[aria-label="inc"]';
const SPEC = { landed: [LANDED], add: [ADD], increment: [INC] };
/**
 * A card that can be told to hide its control, refuse clicks for a while, or
 * fail to register an add - the three ways this really goes wrong. Records what
 * the ladder did, so the test asserts on behaviour and not on call counts.
 */
function fakeCard(init) {
    const st = {
        landed: init.landed ?? false,
        addPresent: init.addPresent ?? true,
        addVisible: init.addVisible ?? true,
        stubborn: init.stubbornClicks ?? 0,
        clicks: 0,
        scrolls: 0,
    };
    const log = [];
    const exists = (sel) => sel === LANDED ? st.landed : sel === ADD ? st.addPresent : true;
    const el = (sel) => ({
        count: async () => (exists(sel) ? 1 : 0),
        isVisible: async () => (sel === LANDED ? st.landed : sel === ADD ? st.addVisible : true),
        waitFor: async () => {
            if (exists(sel))
                return;
            throw new Error('not attached');
        },
        scrollIntoViewIfNeeded: async () => {
            log.push('scroll');
            st.scrolls++;
            st.addVisible = init.visibleAfterScroll ?? true;
        },
        click: async (o = {}) => {
            log.push(o.force ? 'click:force' : 'click');
            st.clicks++;
            if (st.clicks <= st.stubborn)
                throw new Error('element is not visible');
            if (init.landOnAcceptedClick)
                st.landed = true;
        },
        // Real blocker read: what is at the control's centre point. The fake page
        // has no overlays, so this reports "nothing in the way" unless told otherwise.
        evaluate: async (fn) => fn({
            getBoundingClientRect: () => ({ width: 100, height: 40, left: 10, top: 10 }),
            contains: () => false,
        }),
    });
    const card = { locator: (sel) => ({ first: () => el(sel) }) };
    return { card: card, log, st };
}
/** addViaCard is protected; reach it the way the other tests reach protected members. */
const ladder = (card, quantity = 1) => new BlinkitPlatform().addViaCard(card, SPEC, quantity);
test("addViaCard: a normal card is added on the first click", async () => {
    const { card, log } = fakeCard({ landOnAcceptedClick: true });
    assert.equal(await ladder(card), 'added');
    assert.deepEqual(log, ['click']);
});
test("addViaCard: an item already in the cart is reported, not clicked again", async () => {
    const { card, log, st } = fakeCard({ landed: true });
    assert.equal(await ladder(card), 'already');
    assert.deepEqual(log, [], 'must not touch a card that already shows a stepper');
    assert.equal(st.clicks, 0);
});
test("addViaCard: an off-screen control is scrolled into view before any click", async () => {
    const { card, log } = fakeCard({ addVisible: false, landOnAcceptedClick: true });
    assert.equal(await ladder(card), 'added');
    assert.deepEqual(log, ['scroll', 'click']);
});
test("addViaCard: a control that stays hidden is clicked with force only after the normal rung fails", async () => {
    const { card, log } = fakeCard({ addVisible: false, visibleAfterScroll: false, stubbornClicks: Infinity });
    assert.equal(await ladder(card), 'failed');
    assert.deepEqual(log, ['scroll', 'click', 'click:force']);
});
test("addViaCard: a click that reports success but changes nothing is not reported as an add", async () => {
    // The click resolves; the stepper never appears. Reporting success here is
    // how a caller ends up verifying a cart that was never touched.
    const { card, log } = fakeCard({}); // no landOnAcceptedClick: nothing ever lands
    assert.equal(await ladder(card), 'failed');
    assert.equal(log.filter(l => l.startsWith('click')).length, ADD_RUNGS.length);
});
test("addViaCard: a card with no control at all is 'absent', so the caller can stop the batch", async () => {
    const { card, log } = fakeCard({ addPresent: false });
    assert.equal(await ladder(card), 'absent');
    assert.deepEqual(log, [], 'never spends a click budget on a control that is not there');
});
test("addViaCard: quantity is topped up after the add lands, but never on a landed card", async () => {
    const three = fakeCard({ landOnAcceptedClick: true });
    assert.equal(await ladder(three.card, 3), 'added');
    // One ADD plus two increments, each press re-resolving the stepper.
    assert.equal(three.st.clicks, 3);
    const landed = fakeCard({ landed: true });
    assert.equal(await ladder(landed.card, 3), 'already');
    assert.equal(landed.st.clicks, 0, 'a landed card is never topped up either');
});
test("blockedBy: reports what covers the control, and never throws", async () => {
    const covers = (tag) => ({ evaluate: async () => `${tag} is covering it` });
    assert.equal(await blockedBy(covers('div#cookie-banner')), 'div#cookie-banner is covering it');
    // Nothing in the way: null, so the caller reports a plain failure rather than
    // inventing a cause.
    assert.equal(await blockedBy({ evaluate: async () => null }), null);
    // A locator that cannot answer must degrade to null. This runs on the failure
    // path of a failed add, where throwing would replace a diagnosis with a crash.
    assert.equal(await blockedBy({}), null);
    assert.equal(await blockedBy({ evaluate: async () => { throw new Error('detached'); } }), null);
});
//# sourceMappingURL=logic.test.js.map