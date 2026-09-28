// Strava link storage (migrations/0085_v2_strava.sql) plus the two small crypto pieces it needs:
// token encryption at rest and the signed OAuth `state`. Both are keyed off STRAVA_CLIENT_SECRET,
// which only this Worker and Strava know. Rotating that secret invalidates stored tokens; the
// affected users simply see "reconnect Strava".
import { nowIso, type DB } from "../../db/repos/shared";

export interface StravaTokens {
  access: string;
  refresh: string;
  expiresAt: number; // epoch seconds, as Strava returns it
}

export interface StravaLink {
  accountId: number;
  athleteId: number;
  tokens: StravaTokens;
  lastSyncAt: string | null;
  lastError: string | null;
}

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`strava-tokens:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptTokens(tokens: StravaTokens, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(tokens)));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function decryptTokens(stored: string, secret: string): Promise<StravaTokens | null> {
  try {
    const [iv, ct] = stored.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(ct));
    const t = JSON.parse(new TextDecoder().decode(pt)) as StravaTokens;
    return typeof t.access === "string" && typeof t.refresh === "string" ? t : null;
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`strava-state:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** OAuth `state` binding the callback to the account that started it, valid for 15 minutes. */
export async function signState(accountId: number, secret: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + 15 * 60;
  return `${accountId}.${exp}.${await hmacHex(secret, `${accountId}.${exp}`)}`;
}

export async function verifyState(state: string, secret: string, now = Date.now()): Promise<number | null> {
  const m = /^(\d+)\.(\d+)\.([0-9a-f]{32})$/.exec(state);
  if (!m) return null;
  const [, id, exp, sig] = m;
  if (Number(exp) < Math.floor(now / 1000)) return null;
  return (await hmacHex(secret, `${id}.${exp}`)) === sig ? Number(id) : null;
}

export async function saveStravaLink(db: DB, accountId: number, athleteId: number, tokens: StravaTokens, secret: string): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_strava_links (accountId, athleteId, tokens, lastSyncAt, lastError, createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET athleteId = excluded.athleteId, tokens = excluded.tokens, lastError = NULL, updatedAt = excluded.updatedAt`,
    )
    .bind(accountId, athleteId, await encryptTokens(tokens, secret), now, now)
    .run();
}

export async function updateStravaTokens(db: DB, accountId: number, tokens: StravaTokens, secret: string): Promise<void> {
  await db.prepare("UPDATE v2_strava_links SET tokens = ?, updatedAt = ? WHERE accountId = ?").bind(await encryptTokens(tokens, secret), nowIso(), accountId).run();
}

export async function getStravaLink(db: DB, accountId: number, secret: string): Promise<StravaLink | null> {
  const r = await db
    .prepare("SELECT accountId, athleteId, tokens, lastSyncAt, lastError FROM v2_strava_links WHERE accountId = ?")
    .bind(accountId)
    .first<{ accountId: number; athleteId: number; tokens: string; lastSyncAt: string | null; lastError: string | null }>();
  if (!r) return null;
  const tokens = await decryptTokens(r.tokens, secret);
  if (!tokens) return null;
  return { accountId: r.accountId, athleteId: r.athleteId, tokens, lastSyncAt: r.lastSyncAt, lastError: r.lastError };
}

export async function markStravaSync(db: DB, accountId: number, error: string | null): Promise<void> {
  const now = nowIso();
  if (error) await db.prepare("UPDATE v2_strava_links SET lastError = ?, updatedAt = ? WHERE accountId = ?").bind(error.slice(0, 200), now, accountId).run();
  else await db.prepare("UPDATE v2_strava_links SET lastSyncAt = ?, lastError = NULL, updatedAt = ? WHERE accountId = ?").bind(now, now, accountId).run();
}

export async function deleteStravaLink(db: DB, accountId: number): Promise<void> {
  await db.prepare("DELETE FROM v2_strava_links WHERE accountId = ?").bind(accountId).run();
}

/** Accounts due a background sync: linked, healthy or not, not synced in the last `olderThanMs`. */
export async function stravaAccountsDue(db: DB, olderThanIso: string, limit: number): Promise<number[]> {
  const r = await db
    .prepare("SELECT accountId FROM v2_strava_links WHERE lastSyncAt IS NULL OR lastSyncAt < ? ORDER BY COALESCE(lastSyncAt, '') LIMIT ?")
    .bind(olderThanIso, limit)
    .all<{ accountId: number }>();
  return (r.results ?? []).map((x) => x.accountId);
}

export async function importedActivityIds(db: DB, accountId: number, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const r = await db
    .prepare(`SELECT activityId FROM v2_strava_imports WHERE accountId = ? AND activityId IN (${ids.map(() => "?").join(",")})`)
    .bind(accountId, ...ids)
    .all<{ activityId: number }>();
  return new Set((r.results ?? []).map((x) => x.activityId));
}

export async function recordImportedActivities(db: DB, accountId: number, rows: Array<{ activityId: number; date: string }>): Promise<void> {
  const now = nowIso();
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(rows.slice(i, i + 50).map((row) =>
      db.prepare("INSERT OR IGNORE INTO v2_strava_imports (accountId, activityId, date, createdAt) VALUES (?, ?, ?, ?)").bind(accountId, row.activityId, row.date, now)));
  }
}
