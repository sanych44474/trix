import { toHex } from "../domain/secrets";
import type { DB } from "../adapters/d1/shared";

export const SESSION_COOKIE = "__Host-trix_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

export function sessionTokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
  }
  return null;
}

export async function sessionTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(digest));
}

export async function sessionIdentity(db: DB, token: string): Promise<{ accountId: number; method: "email" | "google" | "telegram" } | null> {
  const tokenHash = await sessionTokenHash(token);
  const now = new Date().toISOString();
  const row = await db.prepare(
    "SELECT accountId, authMethod FROM v2_auth_sessions WHERE tokenHash = ? AND expiresAt > ?",
  ).bind(tokenHash, now).first<{ accountId: number; authMethod: "email" | "google" | "telegram" }>();
  return row ? { accountId: row.accountId, method: row.authMethod } : null;
}

export async function createSession(db: DB, accountId: number, method: "email" | "google" | "telegram" = "email"): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(bytes);
  const now = new Date();
  await db.prepare(
    "INSERT INTO v2_auth_sessions (tokenHash, accountId, authMethod, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)",
  ).bind(
    await sessionTokenHash(token),
    accountId,
    method,
    now.toISOString(),
    new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(),
  ).run();
  return token;
}

export async function revokeSession(db: DB, token: string | null): Promise<void> {
  if (!token) return;
  await db.prepare("DELETE FROM v2_auth_sessions WHERE tokenHash = ?").bind(await sessionTokenHash(token)).run();
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}
