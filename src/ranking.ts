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
