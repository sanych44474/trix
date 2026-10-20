import { withinLimit } from "../limits";
import { getUser } from "../adapters/d1/v2Users";
import type { DB } from "../adapters/d1/shared";
import { safeEqual, toHex } from "../domain/secrets";
import type { Env, Lang } from "../types";
import { createSession, sessionCookie } from "./appSessions";
import { miniAppIdentity } from "./auth";
import { readAuthJson } from "./authHttp";

const CHALLENGE_TTL_MS = 10 * 60_000;
const encoder = new TextEncoder();
type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };
type GoogleClaims = { iss?: unknown; aud?: unknown; azp?: unknown; exp?: unknown; iat?: unknown; nonce?: unknown; sub?: unknown; email?: unknown; email_verified?: unknown };
let cachedGoogleKeys: { keys: Jwk[]; expiresAt: number } | null = null;

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const out = new Headers(headers);
  out.set("content-type", "application/json; charset=utf-8");
  out.set("cache-control", "no-store");
  return Response.json({ data }, { status, headers: out });
}

function failure(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

function sameOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === url.origin;
}

function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function lang(value: unknown): Lang {
  return value === "en" ? "en" : "uk";
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function getGoogleKeys(refresh = false): Promise<Jwk[]> {
  if (!refresh && cachedGoogleKeys && cachedGoogleKeys.expiresAt > Date.now()) return cachedGoogleKeys.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const payload = await response.json() as { keys?: Jwk[] };
  if (!Array.isArray(payload.keys)) throw new Error("Google signing keys invalid");
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/i)?.[1] ?? 300);
  cachedGoogleKeys = { keys: payload.keys, expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000 };
  return payload.keys;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
}

async function verifyGoogleToken(token: string, clientId: string): Promise<GoogleClaims | null> {
  if (token.length > 12_000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: GoogleClaims;
  try {
    header = decodeJsonPart(parts[0]);
    claims = decodeJsonPart(parts[1]) as GoogleClaims;
  } catch { return null; }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  let keys: Jwk[];
  try { keys = await getGoogleKeys(); } catch { return null; }
  let jwk = keys.find((key) => key.kid === header.kid && key.use !== "enc");
  if (!jwk) {
    try { jwk = (await getGoogleKeys(true)).find((key) => key.kid === header.kid && key.use !== "enc"); }
    catch { return null; }
  }
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
  } catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  const audienceOk = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  if ((claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") || !audienceOk ||
      (claims.azp !== undefined && claims.azp !== clientId) || typeof claims.sub !== "string" || !claims.sub ||
      typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now + 60 ||
      typeof claims.nonce !== "string") return null;
  return claims;
}

async function createGoogleAccount(db: DB, subject: string, email: string | null, now: string, accountLang: Lang): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const accountId = -(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    const chatId = -(4_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000_000));
    const statements = [
      db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, botBlocked, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', 1, ?, ?)").bind(accountId, accountId, chatId, now, now),
      db.prepare("INSERT INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, ?, '{}', ?)").bind(accountId, accountLang, now),
      db.prepare("INSERT INTO v2_preferences (accountId, lang, updatedAt) VALUES (?, ?, ?)").bind(accountId, accountLang, now),
      db.prepare("INSERT INTO v2_onboarding (accountId, status, sessionMode, updatedAt) VALUES (?, 'in_progress', 'idle', ?)").bind(accountId, now),
      db.prepare("INSERT INTO v2_auth_identities (provider, subject, accountId, email, createdAt) VALUES ('google', ?, ?, ?, ?)").bind(subject, accountId, email, now),
    ];
    if (email) statements.push(db.prepare("INSERT INTO v2_auth_emails (email, accountId, createdAt) VALUES (?, ?, ?)").bind(email, accountId, now));
    try {
      await db.batch(statements);
      return accountId;
    } catch (err) {
      const existingIdentity = await db.prepare("SELECT accountId FROM v2_auth_identities WHERE provider = 'google' AND subject = ?").bind(subject).first<{ accountId: number }>().catch(() => null);
      if (existingIdentity) return existingIdentity.accountId;
      const existingEmail = email ? await db.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>().catch(() => null) : null;
      if (existingEmail) return existingEmail.accountId;
      if (attempt === 4) throw err;
    }
  }
  throw new Error("Google account creation failed");
}

async function attachGoogleIdentity(db: DB, subject: string, email: string | null, accountId: number, now: string): Promise<boolean> {
  const existing = await db.prepare("SELECT accountId FROM v2_auth_identities WHERE provider = 'google' AND subject = ?").bind(subject).first<{ accountId: number }>();
  if (existing && existing.accountId !== accountId) return false;
  let emailIsMapped = false;
  if (email) {
    const mappedEmail = await db.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>();
    if (mappedEmail && mappedEmail.accountId !== accountId) return false;
    emailIsMapped = !!mappedEmail;
  }
  const statements = existing ? [] : [db.prepare("INSERT INTO v2_auth_identities (provider, subject, accountId, email, createdAt) VALUES ('google', ?, ?, ?, ?)").bind(subject, accountId, email, now)];
  if (email && !emailIsMapped) statements.push(db.prepare("INSERT INTO v2_auth_emails (email, accountId, createdAt) VALUES (?, ?, ?)").bind(email, accountId, now));
  if (!statements.length) return true;
  try {
    await db.batch(statements);
  } catch {
    const raced = await db.prepare("SELECT accountId FROM v2_auth_identities WHERE provider = 'google' AND subject = ?").bind(subject).first<{ accountId: number }>();
    const mappedEmail = email ? await db.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>() : null;
    if (raced?.accountId === accountId && (!mappedEmail || mappedEmail.accountId === accountId)) return true;
    if (!raced && mappedEmail?.accountId === accountId) {
      try {
        await db.prepare("INSERT INTO v2_auth_identities (provider, subject, accountId, email, createdAt) VALUES ('google', ?, ?, ?, ?)").bind(subject, accountId, email, now).run();
        return true;
      } catch {
        const retry = await db.prepare("SELECT accountId FROM v2_auth_identities WHERE provider = 'google' AND subject = ?").bind(subject).first<{ accountId: number }>();
        return retry?.accountId === accountId;
      }
    }
    return false;
  }
  return true;
}

async function providersRoute(env: Env): Promise<Response> {
  const username = env.BOT_USERNAME?.replace(/^@/, "");
  return json({ googleClientId: env.GOOGLE_CLIENT_ID ?? null, telegramAvailable: !!username && /^[A-Za-z0-9_]{5,32}$/.test(username) });
}

async function googleNonceRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  if (!env.GOOGLE_CLIENT_ID) return failure("google_unavailable", "Google sign-in is not configured", 503);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `google-start:${ip}`))) return failure("rate_limited", "Too many attempts. Try again later.", 429);
  const identity = await miniAppIdentity(req, url, env);
  const id = randomHex(16);
  const nonce = randomHex(32);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare("DELETE FROM v2_auth_google_challenges WHERE expiresAt <= ?").bind(nowIso).run();
  await env.DB.prepare("INSERT INTO v2_auth_google_challenges (id, nonceHash, linkAccountId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)")
    .bind(id, await sha256Hex(nonce), identity?.user._id ?? null, nowIso, expiresAt).run();
  return json({ challengeId: id, nonce, clientId: env.GOOGLE_CLIENT_ID, expiresInSeconds: CHALLENGE_TTL_MS / 1000 });
}

async function googleVerifyRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  if (!env.GOOGLE_CLIENT_ID) return failure("google_unavailable", "Google sign-in is not configured", 503);
  const payload = await readAuthJson(req);
  const challengeId = typeof payload?.challengeId === "string" && /^[0-9a-f]{32}$/.test(payload.challengeId) ? payload.challengeId : "";
  const token = typeof payload?.idToken === "string" ? payload.idToken : "";
  if (!challengeId || !token) return failure("invalid_google_token", "The Google sign-in response is invalid", 400);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `google-verify:${ip}`))) return failure("rate_limited", "Too many attempts. Try again later.", 429);

  const now = new Date().toISOString();
  const challenge = await env.DB.prepare("SELECT id, nonceHash, linkAccountId FROM v2_auth_google_challenges WHERE id = ? AND expiresAt > ? AND consumedAt IS NULL")
    .bind(challengeId, now).first<{ id: string; nonceHash: string; linkAccountId: number | null }>();
  if (!challenge) return failure("invalid_google_challenge", "This sign-in request expired. Try again.", 401);
  const claims = await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID);
  if (!claims || !safeEqual(challenge.nonceHash, await sha256Hex(String(claims.nonce)))) {
    return failure("invalid_google_token", "Google could not verify this sign-in. Try again.", 401);
  }

  const consumed = await env.DB.prepare("UPDATE v2_auth_google_challenges SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL AND expiresAt > ? RETURNING id")
    .bind(now, challengeId, now).first<{ id: string }>();
  if (!consumed) return failure("invalid_google_challenge", "This sign-in request was already used. Try again.", 401);

  const subject = claims.sub as string;
  const email = claims.email_verified === true ? normalizeEmail(claims.email) : null;
  const identity = await env.DB.prepare("SELECT accountId FROM v2_auth_identities WHERE provider = 'google' AND subject = ?")
    .bind(subject).first<{ accountId: number }>();
  let accountId: number;
  if (identity) {
    if (challenge.linkAccountId !== null && challenge.linkAccountId !== identity.accountId) return failure("identity_in_use", "This Google account is already connected to another TRIX account.", 409);
    accountId = identity.accountId;
  } else if (challenge.linkAccountId !== null) {
    accountId = challenge.linkAccountId;
    if (!(await attachGoogleIdentity(env.DB, subject, email, accountId, now))) return failure("identity_in_use", "This Google account or email is already connected elsewhere.", 409);
  } else {
    const emailMapping = email ? await env.DB.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>() : null;
    accountId = emailMapping?.accountId ?? await createGoogleAccount(env.DB, subject, email, now, lang(payload?.lang));
    if (!(await attachGoogleIdentity(env.DB, subject, email, accountId, now))) return failure("identity_in_use", "This Google account is already connected elsewhere.", 409);
  }

  const account = await getUser(env.DB, accountId);
  if (!account || account.blocked) return failure("account_unavailable", "This account is unavailable", 403);
  const session = await createSession(env.DB, accountId, "google");
  return json({ authenticated: true, accountId, method: "google", email }, 200, { "set-cookie": sessionCookie(session) });
}

async function telegramStartRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  const username = env.BOT_USERNAME?.replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return failure("telegram_unavailable", "Telegram login is not configured", 503);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `telegram-start:${ip}`))) return failure("rate_limited", "Too many attempts. Try again later.", 429);
  const now = new Date();
  const id = randomHex(16);
  // The ID is public because it appears in Telegram's deep link. A separate secret binds
  // completion to the browser tab that initiated sign-in and prevents login CSRF via shared links.
  const completionToken = randomHex(32);
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  await env.DB.prepare("DELETE FROM v2_auth_telegram_challenges WHERE expiresAt <= ?").bind(nowIso).run();
  await env.DB.prepare("INSERT INTO v2_auth_telegram_challenges (id, completionHash, createdAt, expiresAt) VALUES (?, ?, ?, ?)")
    .bind(id, await sha256Hex(completionToken), nowIso, expiresAt).run();
  return json({ challengeId: id, completionToken, telegramUrl: `https://t.me/${username}?start=login_${id}`, expiresInSeconds: CHALLENGE_TTL_MS / 1000 });
}

async function telegramStatusRoute(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get("challengeId") ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) return failure("invalid_challenge", "The login request is invalid", 400);
  const now = new Date().toISOString();
  const challenge = await env.DB.prepare("SELECT verifiedAccountId FROM v2_auth_telegram_challenges WHERE id = ? AND expiresAt > ? AND consumedAt IS NULL")
    .bind(id, now).first<{ verifiedAccountId: number | null }>();
  return json({ verified: challenge?.verifiedAccountId !== null && challenge?.verifiedAccountId !== undefined, expired: !challenge });
}

async function telegramCompleteRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  const payload = await readAuthJson(req);
  const id = typeof payload?.challengeId === "string" && /^[0-9a-f]{32}$/.test(payload.challengeId) ? payload.challengeId : "";
  const completionToken = typeof payload?.completionToken === "string" && /^[0-9a-f]{64}$/.test(payload.completionToken) ? payload.completionToken : "";
  if (!id || !completionToken) return failure("invalid_challenge", "The login request is invalid", 400);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `telegram-complete:${ip}`))) return failure("rate_limited", "Too many attempts. Try again later.", 429);
  const now = new Date().toISOString();
  const challenge = await env.DB.prepare("SELECT verifiedAccountId, completionHash FROM v2_auth_telegram_challenges WHERE id = ? AND expiresAt > ? AND consumedAt IS NULL")
    .bind(id, now).first<{ verifiedAccountId: number | null; completionHash: string }>();
  if (!challenge || !safeEqual(challenge.completionHash, await sha256Hex(completionToken))) {
    return failure("invalid_challenge", "This login request is invalid or expired. Start again.", 401);
  }
  if (!challenge?.verifiedAccountId) return failure("telegram_not_confirmed", "Confirm the login in Telegram, then try again.", 409);
  const account = await getUser(env.DB, challenge.verifiedAccountId);
  if (!account || account.blocked) return failure("account_unavailable", "This account is unavailable", 403);
  const consumed = await env.DB.prepare("UPDATE v2_auth_telegram_challenges SET consumedAt = ? WHERE id = ? AND completionHash = ? AND consumedAt IS NULL AND expiresAt > ? AND verifiedAccountId = ? RETURNING verifiedAccountId")
    .bind(now, id, challenge.completionHash, now, challenge.verifiedAccountId).first<{ verifiedAccountId: number }>();
  if (!consumed) return failure("invalid_challenge", "This login request was already used. Start again.", 401);
  const session = await createSession(env.DB, consumed.verifiedAccountId, "telegram");
  const email = await env.DB.prepare("SELECT email FROM v2_auth_emails WHERE accountId = ? ORDER BY createdAt LIMIT 1")
    .bind(consumed.verifiedAccountId).first<{ email: string }>();
  return json({ authenticated: true, accountId: consumed.verifiedAccountId, method: "telegram", email: email?.email ?? null }, 200, { "set-cookie": sessionCookie(session) });
}

/** Called from /start's login_<id> deep link after grammY has authenticated and loaded the sender. */
export async function confirmTelegramLogin(db: DB, challengeId: string, accountId: number): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(challengeId)) return false;
  const now = new Date().toISOString();
  const confirmed = await db.prepare("UPDATE v2_auth_telegram_challenges SET verifiedAccountId = ? WHERE id = ? AND verifiedAccountId IS NULL AND consumedAt IS NULL AND expiresAt > ? RETURNING id")
    .bind(accountId, challengeId, now).first<{ id: string }>();
  return !!confirmed;
}

export async function handleProviderAuth(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (url.pathname === "/api/v2/auth/providers" && req.method === "GET") return providersRoute(env);
  if (url.pathname === "/api/v2/auth/google/nonce" && req.method === "POST") return googleNonceRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/google/verify" && req.method === "POST") return googleVerifyRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/telegram/start" && req.method === "POST") return telegramStartRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/telegram/status" && req.method === "GET") return telegramStatusRoute(url, env);
  if (url.pathname === "/api/v2/auth/telegram/complete" && req.method === "POST") return telegramCompleteRoute(req, url, env);
  return null;
}
