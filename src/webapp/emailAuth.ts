import { withinLimit } from "../limits";
import { getUser } from "../adapters/d1/v2Users";
import { randomBelow, randomDigits, safeEqual, toHex } from "../domain/secrets";
import type { Env, Lang } from "../types";
import { createSession, revokeSession, sessionDelivery, sessionTokenFromRequest, clearedSessionCookie } from "./appSessions";
import { miniAppIdentity } from "./auth";
import { readAuthJson } from "./authHttp";

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enc = new TextEncoder();
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

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

async function digestCode(secret: string, challengeId: string, email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${challengeId}\n${email}\n${code}`))));
}

function requestLang(value: unknown): Lang {
  return value === "en" ? "en" : "uk";
}

function emailMessage(code: string, lang: Lang): { subject: string; text: string; html: string } {
  if (lang === "en") return {
    subject: "Your TRIX sign-in code",
    text: `Your TRIX sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: `<p>Your TRIX sign-in code:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>It expires in 10 minutes. If you did not request it, ignore this email.</p>`,
  };
  return {
    subject: "Код входу в TRIX",
    text: `Ваш код входу в TRIX: ${code}. Він діє 10 хвилин. Якщо ви не запитували цей код, проігноруйте лист.`,
    html: `<p>Ваш код входу в TRIX:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>Код діє 10 хвилин. Якщо ви не запитували його, проігноруйте лист.</p>`,
  };
}

async function sendCode(env: Env, email: string, code: string, lang: Lang): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return false;
  const message = emailMessage(code, lang);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [email], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) console.warn("auth_email_delivery_failed", response.status);
    return response.ok;
  } catch (err) {
    console.warn("auth_email_delivery_failed", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function createEmailAccount(env: Env, email: string, lang: Lang, now: string): Promise<number> {
  // Email-only accounts use negative identity values and an unreachable synthetic chat ID.
  // This keeps Telegram IDs untouched and botBlocked prevents scheduled Telegram delivery.
  for (let attempt = 0; attempt < 4; attempt++) {
    const accountId = -(1_000_000_000 + randomBelow(1_000_000_000));
    const chatId = -(4_000_000_000_000_000 + randomBelow(1_000_000_000) * 1_000 + randomBelow(1_000));
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, botBlocked, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', 1, ?, ?)").bind(accountId, accountId, chatId, now, now),
        env.DB.prepare("INSERT INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, ?, '{}', ?)").bind(accountId, lang, now),
        env.DB.prepare("INSERT INTO v2_preferences (accountId, lang, updatedAt) VALUES (?, ?, ?)").bind(accountId, lang, now),
        env.DB.prepare("INSERT INTO v2_onboarding (accountId, status, sessionMode, updatedAt) VALUES (?, 'in_progress', 'idle', ?)").bind(accountId, now),
        env.DB.prepare("INSERT INTO v2_auth_emails (email, accountId, createdAt) VALUES (?, ?, ?)").bind(email, accountId, now),
      ]);
      return accountId;
    } catch (err) {
      const raced = await env.DB.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>().catch(() => null);
      if (raced) return raced.accountId;
      if (attempt === 3) throw err;
    }
  }
  throw new Error("account creation failed");
}

async function sessionRoute(req: Request, url: URL, env: Env): Promise<Response> {
  const identity = await miniAppIdentity(req, url, env);
  if (!identity) return json({ authenticated: false });
  const [email, google] = await Promise.all([
    env.DB.prepare("SELECT email FROM v2_auth_emails WHERE accountId = ? LIMIT 1").bind(identity.user._id).first<{ email: string }>(),
    env.DB.prepare("SELECT 1 AS linked FROM v2_auth_identities WHERE provider = 'google' AND accountId = ? LIMIT 1").bind(identity.user._id).first<{ linked: number }>(),
  ]);
  return json({ authenticated: true, accountId: identity.user._id, method: identity.method, email: email?.email ?? null, googleLinked: !!google });
}

async function startRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) {
    return failure("auth_unavailable", "Email sign-in is not configured", 503);
  }
  const payload = await readAuthJson(req);
  const email = normalizeEmail(payload?.email);
  if (!email) return failure("invalid_email", "Enter a valid email address", 400);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `start-ip:${ip}`)) || !(await withinLimit(env, "auth", `start-email:${email}`))) {
    return failure("rate_limited", "Too many attempts. Try again later.", 429);
  }

  const identity = await miniAppIdentity(req, url, env);
  const id = randomHex(16);
  const code = randomDigits(6);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();
  const codeHash = await digestCode(env.AUTH_SECRET, id, email, code);
  await env.DB.prepare("DELETE FROM v2_auth_email_challenges WHERE createdAt < ?").bind(new Date(now.getTime() - 86_400_000).toISOString()).run();
  await env.DB.prepare("DELETE FROM v2_auth_sessions WHERE expiresAt <= ?").bind(nowIso).run();
  const inserted = await env.DB.prepare(
    `INSERT INTO v2_auth_email_challenges (id, email, codeHash, linkAccountId, createdAt, expiresAt)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM v2_auth_email_challenges WHERE email = ? AND createdAt > ? AND consumedAt IS NULL)`,
  ).bind(id, email, codeHash, identity?.user._id ?? null, nowIso, expiresAt, email, new Date(now.getTime() - 60_000).toISOString()).run();
  if (!inserted.meta.changes) return failure("rate_limited", "A code was sent recently. Try again in a minute.", 429);
  if (!(await sendCode(env, email, code, requestLang(payload?.lang)))) {
    await env.DB.prepare("UPDATE v2_auth_email_challenges SET consumedAt = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return failure("email_delivery_failed", "Could not send the code. Try again later.", 502);
  }
  return json({ challengeId: id, expiresInSeconds: OTP_TTL_MS / 1000 });
}

async function verifyRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) return failure("auth_unavailable", "Email sign-in is not configured", 503);
  const payload = await readAuthJson(req);
  const email = normalizeEmail(payload?.email);
  const challengeId = typeof payload?.challengeId === "string" && /^[0-9a-f]{32}$/.test(payload.challengeId) ? payload.challengeId : "";
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";
  if (!email || !challengeId || !/^\d{6}$/.test(code)) return failure("invalid_code", "Enter the six-digit code", 400);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await withinLimit(env, "auth", `verify-ip:${ip}`)) || !(await withinLimit(env, "auth", `verify-email:${email}`))) {
    return failure("rate_limited", "Too many attempts. Try again later.", 429);
  }
  const now = new Date().toISOString();
  const challenge = await env.DB.prepare(
    "SELECT id, codeHash, linkAccountId, attempts FROM v2_auth_email_challenges WHERE id = ? AND email = ? COLLATE NOCASE AND expiresAt > ? AND consumedAt IS NULL",
  ).bind(challengeId, email, now).first<{ id: string; codeHash: string; linkAccountId: number | null; attempts: number }>();
  if (!challenge || challenge.attempts >= MAX_ATTEMPTS) return failure("invalid_code", "This code is invalid or expired. Request a new one.", 401);
  const actualHash = await digestCode(env.AUTH_SECRET, challenge.id, email, code);
  if (!safeEqual(challenge.codeHash, actualHash)) {
    await env.DB.prepare("UPDATE v2_auth_email_challenges SET attempts = attempts + 1 WHERE id = ? AND consumedAt IS NULL AND attempts < ?").bind(challengeId, MAX_ATTEMPTS).run();
    return failure("invalid_code", "This code is invalid or expired. Request a new one.", 401);
  }
  const consumed = await env.DB.prepare(
    "UPDATE v2_auth_email_challenges SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL AND expiresAt > ? AND attempts < ? RETURNING id",
  ).bind(now, challengeId, now, MAX_ATTEMPTS).first<{ id: string }>();
  if (!consumed) return failure("invalid_code", "This code is invalid or expired. Request a new one.", 401);

  let accountId: number;
  const mapping = await env.DB.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>();
  if (mapping) {
    if (challenge.linkAccountId !== null && challenge.linkAccountId !== mapping.accountId) {
      return failure("email_in_use", "This email belongs to another account", 409);
    }
    accountId = mapping.accountId;
  } else if (challenge.linkAccountId !== null) {
    const linkedUser = await getUser(env.DB, challenge.linkAccountId);
    if (!linkedUser) return failure("account_unavailable", "The linked account is unavailable", 409);
    try {
      await env.DB.prepare("INSERT INTO v2_auth_emails (email, accountId, createdAt) VALUES (?, ?, ?)").bind(email, challenge.linkAccountId, now).run();
      accountId = challenge.linkAccountId;
    } catch {
      const raced = await env.DB.prepare("SELECT accountId FROM v2_auth_emails WHERE email = ? COLLATE NOCASE").bind(email).first<{ accountId: number }>();
      if (!raced || raced.accountId !== challenge.linkAccountId) return failure("email_in_use", "This email belongs to another account", 409);
      accountId = raced.accountId;
    }
  } else {
    accountId = await createEmailAccount(env, email, requestLang(payload?.lang), now);
  }
  const account = await getUser(env.DB, accountId);
  if (!account || account.blocked) return failure("account_unavailable", "This account is unavailable", 403);
  const delivery = sessionDelivery(req, await createSession(env.DB, accountId));
  return json({ authenticated: true, accountId, method: "email", email, ...delivery.body }, 200, delivery.headers);
}

async function logoutRoute(req: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(req, url)) return failure("origin_forbidden", "Request origin is not allowed", 403);
  await revokeSession(env.DB, sessionTokenFromRequest(req));
  return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
}

export async function handleEmailAuth(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (url.pathname === "/api/v2/auth/session" && req.method === "GET") return sessionRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/email/start" && req.method === "POST") return startRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/email/verify" && req.method === "POST") return verifyRoute(req, url, env);
  if (url.pathname === "/api/v2/auth/logout" && req.method === "POST") return logoutRoute(req, url, env);
  return null;
}
