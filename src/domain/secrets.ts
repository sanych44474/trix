// The one module that compares secrets and signs/verifies links. Before this, seven places compared
// a secret or signature with === / !== (admin header, webhook secret, the bot's /admin command,
// Telegram initData, the /v redirect, the weekly body-map link, the Strava OAuth state) and four
// files each carried their own copy of "import a raw HMAC key, sign, hex-encode, truncate".
//
// Two properties live here and nowhere else:
//  - comparison is constant-time over the bytes, so a wrong guess does not reveal how many leading
//    characters were right;
//  - the signing schemes are byte-for-byte what they were before (callers pick key, message and
//    truncation length), so links already sent in chats keep verifying. test/secrets.test.ts pins
//    that against an independent implementation.
//
// Web Crypto only -- no Node imports -- so it runs unchanged in the Worker and in node:test.
const enc = new TextEncoder();

/** Constant-time string equality over UTF-8 bytes. Only the length can leak, never the content. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Equality for a presented credential against an expected secret. A missing or empty expected
 * secret never matches, so an unset env var cannot turn "no header" into "authorized". */
export function secretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  return !!expected && !!presented && safeEqual(presented, expected);
}

export async function hmacSha256(key: string | Uint8Array, message: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

export function toHex(bytes: Uint8Array, take = bytes.length): string {
  return [...bytes.slice(0, take)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 of `message` keyed on `secret`, hex-encoded and truncated to `bytes` bytes. */
export async function macHex(secret: string, message: string, bytes: number): Promise<string> {
  return toHex(await hmacSha256(secret, message), bytes);
}

/** True when `sig` is the MAC of `message`. An empty signature is never valid. */
export async function verifyMac(secret: string, message: string, sig: string, bytes: number): Promise<boolean> {
  if (!sig) return false;
  return safeEqual(await macHex(secret, message, bytes), sig);
}
