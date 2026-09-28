// Voluntary Telegram Stars support (migrations/0084_v2_support_donations.sql).
import { nowIso, type DB } from "../../db/repos/shared";

/** The amounts offered in the app and the bot. Anything else in a payload is rejected. */
export const SUPPORT_STAR_AMOUNTS = [50, 100, 250] as const;

export function isSupportAmount(stars: number): boolean {
  return (SUPPORT_STAR_AMOUNTS as readonly number[]).includes(stars);
}

export function supportPayload(stars: number): string {
  return `support:${stars}`;
}

/** Parses an invoice payload back; null for anything that isn't one of ours. */
export function parseSupportPayload(payload: string): number | null {
  const m = /^support:(\d+)$/.exec(payload);
  const stars = m ? Number(m[1]) : NaN;
  return isSupportAmount(stars) ? stars : null;
}

/** Records a successful payment; false when this charge was already recorded (redelivery). */
export async function recordSupportPayment(db: DB, accountId: number, stars: number, chargeId: string): Promise<boolean> {
  const r = await db
    .prepare("INSERT OR IGNORE INTO v2_support_payments (accountId, stars, chargeId, createdAt) VALUES (?, ?, ?, ?)")
    .bind(accountId, stars, chargeId, nowIso())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function supportTotals(db: DB): Promise<{ payments: number; stars: number; supporters: number }> {
  const r = await db
    .prepare("SELECT COUNT(*) AS payments, COALESCE(SUM(stars), 0) AS stars, COUNT(DISTINCT accountId) AS supporters FROM v2_support_payments")
    .first<{ payments: number; stars: number; supporters: number }>();
  return { payments: r?.payments ?? 0, stars: r?.stars ?? 0, supporters: r?.supporters ?? 0 };
}
