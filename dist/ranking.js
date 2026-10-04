/** Search labels append pack sizes, sometimes nested: "Milk (1 pack (500 ml))". */
export function stripPackSize(name) {
    const text = name.trim();
    if (!text.endsWith(')'))
        return text;
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === ')')
            depth++;
        if (text[i] === '(' && --depth === 0)
            return text.slice(0, i).trim();
    }
    return text;
}
// Price per 100 ml/g (or per piece) so different pack sizes compare fairly.
// ponytail: handles "450 ml", "1 L", "2 x 500 g", "6 pcs"; anything else is
// ranked by raw price.
export function unitPrice(p) {
    const m = p.quantity?.toLowerCase().match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|g|gm|kg|pc|pcs|pieces?|units?)\b/);
    if (!m)
        return { value: p.price, label: 'pack' };
    const amount = Number(m[1] || 1) * Number(m[2]);
    const unit = m[3];
    if (unit === 'ml' || unit === 'g' || unit === 'gm')
        return { value: (p.price / amount) * 100, label: unit === 'ml' ? '100 ml' : '100 g' };
    if (unit === 'kg' || unit.startsWith('l'))
        return { value: p.price / (amount * 10), label: unit === 'kg' ? '100 g' : '100 ml' };
    return { value: p.price / amount, label: 'pc' };
}
// In-stock products whose name contains every query word.
// Includes known brand synonyms and separately displayed pack sizes.
export function relevant(query, products) {
    const words = queryWords(query);
    return products.filter(p => p.inStock && words.every(w => hits(productText(p), w)));
}
const normalized = (value) => value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const queryWords = (query) => normalized(query).split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''));
const productText = (p) => normalized(p.name.split('|')[0] + ' ' + p.quantity);
/** Pack count is a shopping quantity; unit value is shown but is not the spend. */
export function rankByPackPrice(products) {
    return products.filter(p => p.inStock && Number.isFinite(p.price) && p.price > 0)
        .map(p => ({ p, u: unitPrice(p) })).sort((a, b) => a.p.price - b.p.price);
}
export function searchQueries(query) {
    const short = /(?:coca[ -]?cola|coke).*zero/i.test(query) ? 'Coke Zero' : query.trim().split(/\s+/).slice(0, 2).join(' ');
    return [...new Set([query.trim(), short, query.trim().split(/\s+/)[0]])].filter(Boolean);
}
// ponytail: tiny hand-made synonym table; extend when a real query misses.
const SYNONYMS = { coke: ['coca-cola', 'coca cola'], pepsi: ['pepsi'], curd: ['dahi'], dahi: ['curd'] };
const hits = (name, word) => [word, ...(SYNONYMS[word] ?? [])].some(w => name.includes(normalized(w)));
// Exact = every query word present and in stock. Otherwise offer in-stock
// partial matches (most words matched first, then cheapest unit price).
export function resolveItem(query, products, max = 5) {
    const words = queryWords(query);
    const seen = new Set();
    products = products.filter(p => { const k = `${p.name}|${p.quantity}`; return !seen.has(k) && !!seen.add(k); });
    const scored = products.map(p => ({ p, n: words.filter(w => hits(productText(p), w)).length })); // title only: Zepto names end with "| The Coca-Cola Company"
    const exact = scored.filter(x => x.n === words.length);
    const byPrice = (a, b) => unitPrice(a.p).value - unitPrice(b.p).value;
    const exactIn = exact.filter(x => x.p.inStock).sort(byPrice).map(x => x.p);
    if (exactIn.length)
        return { query, status: 'match', options: exactIn.slice(0, max), outOfStock: false };
    const partial = scored.filter(x => x.p.inStock && x.n > 0).sort((a, b) => b.n - a.n || byPrice(a, b)).map(x => x.p);
    return { query, status: partial.length ? 'alternatives' : 'none', options: partial.slice(0, max), outOfStock: exact.length > 0 };
}
// Cheapest first by unit price, ranking only the most common unit so ₹/100 ml
// isn't compared against ₹/pc.
export function rankByUnitPrice(products) {
    const priced = products.map(p => ({ p, u: unitPrice(p) }));
    if (priced.length === 0)
        return [];
    const counts = new Map();
    for (const { u } of priced)
        counts.set(u.label, (counts.get(u.label) || 0) + 1);
    const unit = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    return priced.filter(x => x.u.label === unit).sort((a, b) => a.u.value - b.u.value);
}
// Store-closed / unserviceable banners shown on cart pages.
export function storeNotice(pageText) {
    const m = pageText.match(/[^\n]*(currently (unserviceable|closed)|store (is )?(currently )?closed|not accepting orders|add address to proceed|currently unavailable|no longer delivering)[^\n]*/i);
    return m?.[0].trim();
}
// Compare what was requested with what the cart holds, and check items + fees = total.
// ponytail: matches cart rows by case-insensitive name; Blinkit/Zepto cart rows carry no product id.
export function validateCart(wanted, cart) {
    // Platforms label the same product differently: search results append the pack
    // size ("... (750 ml)") while the cart page omits it. Compare on the product
    // name without a trailing parenthesised pack size, or a correctly-added item
    // reads as missing.
    const norm = (s) => stripPackSize(s)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const missing = [], wrongQty = [];
    for (const w of wanted) {
        const row = cart.items.find(i => norm(i.name) === norm(w.name));
        if (!row)
            missing.push(w.name);
        else if (row.cartQuantity !== w.quantity)
            wrongQty.push(`${w.name} (wanted ${w.quantity}, cart has ${row.cartQuantity})`);
    }
    const fees = (cart.fees ?? []).reduce((s, f) => s + f.amount, 0);
    return { missing, wrongQty, billOk: !cart.fees?.length || Math.abs(cart.subtotal + fees - cart.total) <= 1 };
}
//# sourceMappingURL=ranking.js.map