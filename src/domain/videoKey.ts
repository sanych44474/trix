/** Normalize an exercise name into the cache key: trim, lowercase, collapse whitespace. */
export function normalizeVideoKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
