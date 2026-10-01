import type { Product } from './platforms/base.js';

// Price per 100 ml/g (or per piece) so different pack sizes compare fairly.
// ponytail: handles "450 ml", "1 L", "2 x 500 g", "6 pcs"; anything else is
// ranked by raw price.
export function unitPrice(p: Product): { value: number; label: string } {
  const m = p.quantity?.toLowerCase().match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|g|gm|kg|pc|pcs|pieces?|units?)\b/);
  if (!m) return { value: p.price, label: 'pack' };
  const amount = Number(m[1] || 1) * Number(m[2]);
  const unit = m[3];
  if (unit === 'ml' || unit === 'g' || unit === 'gm') return { value: (p.price / amount) * 100, label: unit === 'ml' ? '100 ml' : '100 g' };
  if (unit === 'kg' || unit.startsWith('l')) return { value: p.price / (amount * 10), label: unit === 'kg' ? '100 g' : '100 ml' };
  return { value: p.price / amount, label: 'pc' };
}

// In-stock products whose name contains every query word.
// ponytail: literal word match ("coke" won't match "Coca-Cola"); add synonyms if it bites.
export function relevant(query: string, products: Product[]): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''));
  return products.filter(p => p.inStock && words.every(w => p.name.toLowerCase().includes(w)));
}

// ponytail: tiny hand-made synonym table; extend when a real query misses.
const SYNONYMS: Record<string, string[]> = { coke: ['coca-cola', 'coca cola'], pepsi: ['pepsi'], curd: ['dahi'], dahi: ['curd'] };

const hits = (name: string, word: string) =>
  [word, ...(SYNONYMS[word] ?? [])].some(w => name.includes(w));

export interface Resolution {
  query: string;
  status: 'match' | 'alternatives' | 'none';
  /** match: exact in-stock hits (best first). alternatives: partial in-stock hits. */
  options: Product[];
  /** True when exact matches exist but are all out of stock. */
  outOfStock: boolean;
}

// Exact = every query word present and in stock. Otherwise offer in-stock
// partial matches (most words matched first, then cheapest unit price).
export function resolveItem(query: string, products: Product[], max = 5): Resolution {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''));
  const seen = new Set<string>();
  products = products.filter(p => { const k = `${p.name}|${p.quantity}`; return !seen.has(k) && !!seen.add(k); });
  const scored = products.map(p => ({ p, n: words.filter(w => hits(p.name.toLowerCase(), w)).length }));
  const exact = scored.filter(x => x.n === words.length);
  const byPrice = (a: { p: Product }, b: { p: Product }) => unitPrice(a.p).value - unitPrice(b.p).value;
  const exactIn = exact.filter(x => x.p.inStock).sort(byPrice).map(x => x.p);
  if (exactIn.length) return { query, status: 'match', options: exactIn.slice(0, max), outOfStock: false };
  const partial = scored.filter(x => x.p.inStock && x.n > 0).sort((a, b) => b.n - a.n || byPrice(a, b)).map(x => x.p);
  return { query, status: partial.length ? 'alternatives' : 'none', options: partial.slice(0, max), outOfStock: exact.length > 0 };
}

// Cheapest first by unit price, ranking only the most common unit so ₹/100 ml
// isn't compared against ₹/pc.
export function rankByUnitPrice(products: Product[]): { p: Product; u: { value: number; label: string } }[] {
  const priced = products.map(p => ({ p, u: unitPrice(p) }));
  if (priced.length === 0) return [];
  const counts = new Map<string, number>();
  for (const { u } of priced) counts.set(u.label, (counts.get(u.label) || 0) + 1);
  const unit = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  return priced.filter(x => x.u.label === unit).sort((a, b) => a.u.value - b.u.value);
}

// Compare what was requested with what the cart holds, and check items + fees = total.
// ponytail: matches cart rows by case-insensitive name; Blinkit/Zepto cart rows carry no product id.
export function validateCart(
  wanted: { name: string; quantity: number }[],
  cart: { items: { name: string; cartQuantity: number }[]; subtotal: number; total: number; fees?: { amount: number }[] },
): { missing: string[]; wrongQty: string[]; billOk: boolean } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const missing: string[] = [], wrongQty: string[] = [];
  for (const w of wanted) {
    const row = cart.items.find(i => norm(i.name) === norm(w.name));
    if (!row) missing.push(w.name);
    else if (row.cartQuantity !== w.quantity) wrongQty.push(`${w.name} (wanted ${w.quantity}, cart has ${row.cartQuantity})`);
  }
  const fees = (cart.fees ?? []).reduce((s, f) => s + f.amount, 0);
  return { missing, wrongQty, billOk: !cart.fees?.length || Math.abs(cart.subtotal + fees - cart.total) <= 1 };
}
