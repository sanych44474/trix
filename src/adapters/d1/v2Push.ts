// Native-app push addresses (migrations/0102, 0103). An address belongs to one account at a time: when
// the same phone signs in to another account, registering moves it. `kind` says whether it is a
// legacy FCM token or a Firebase Installation ID (FCM 25.1+), which the send targets differently.
import { nowIso, type DB } from "./shared";

export type PushPlatform = "android" | "ios";
export type PushKind = "token" | "fid";
export interface PushTarget { token: string; kind: PushKind }

export async function registerPushDevice(db: DB, accountId: number, token: string, platform: PushPlatform, appVersion: string | null, kind: PushKind = "token"): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_push_devices (token, accountId, platform, appVersion, kind, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET accountId = excluded.accountId, platform = excluded.platform, appVersion = excluded.appVersion, kind = excluded.kind, updatedAt = excluded.updatedAt`,
    )
    .bind(token, accountId, platform, appVersion, kind, now, now)
    .run();
}

/** Signing out on a device: only that account's own token is removed. */
export async function unregisterPushDevice(db: DB, accountId: number, token: string): Promise<void> {
  await db.prepare("DELETE FROM v2_push_devices WHERE token = ? AND accountId = ?").bind(token, accountId).run();
}

export async function listPushTokens(db: DB, accountId: number): Promise<PushTarget[]> {
  const r = await db.prepare("SELECT token, kind FROM v2_push_devices WHERE accountId = ? ORDER BY updatedAt DESC LIMIT 10").bind(accountId).all<PushTarget>();
  return r.results ?? [];
}

export async function hasPushDevice(db: DB, accountId: number): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM v2_push_devices WHERE accountId = ? LIMIT 1").bind(accountId).first<{ x: number }>());
}

/** FCM said the app was uninstalled or the token rotated. */
export async function deletePushTokens(db: DB, tokens: string[]): Promise<void> {
  if (tokens.length) await db.batch(tokens.map((t) => db.prepare("DELETE FROM v2_push_devices WHERE token = ?").bind(t)));
}
