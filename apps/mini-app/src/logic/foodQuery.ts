// A food search that names several ingredients ("лаваш з хамоном, грушею та сиром") is a dish, not a
// product: no database has it, but the AI free-text log can split it into items with calories.

const JOINERS = /,|\+|&|\s(з|із|зі|та|і|й|with|and|plus)\s/iu;

export function looksLikeDish(query: string): boolean {
  const q = query.trim();
  return JOINERS.test(q) || q.split(/\s+/).length >= 5;
}
