// Price poll answers (v2_price_poll): one row per account, overwritten on re-answer.
import { nowIso, type DB } from "./shared";
import type { PollAnswer, PollChoice } from "../../domain/pricePoll";

/** Record the button answer. A new choice clears a price typed for an earlier "custom" answer. */
export async function recordPollChoice(db: DB, userId: number, choice: PollChoice): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_price_poll (accountId, choice, answeredAt, updatedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET choice = excluded.choice, price = NULL, updatedAt = excluded.updatedAt`,
    )
    .bind(userId, choice, now, now)
    .run();
}

export async function recordPollPrice(db: DB, userId: number, price: number): Promise<void> {
  await db.prepare("UPDATE v2_price_poll SET choice = 'custom', price = ?, updatedAt = ? WHERE accountId = ?").bind(price, nowIso(), userId).run();
}

export async function recordPollWish(db: DB, userId: number, wish: string): Promise<void> {
  await db.prepare("UPDATE v2_price_poll SET wish = ?, updatedAt = ? WHERE accountId = ?").bind(wish, nowIso(), userId).run();
}

export async function hasAnsweredPoll(db: DB, userId: number): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM v2_price_poll WHERE accountId = ?").bind(userId).first());
}

export async function listPollAnswers(db: DB): Promise<(PollAnswer & { wish?: string; updatedAt: string })[]> {
  const r = await db
    .prepare("SELECT choice, price, wish, updatedAt FROM v2_price_poll ORDER BY updatedAt DESC")
    .all<{ choice: PollChoice; price: number | null; wish: string | null; updatedAt: string }>();
  return (r.results ?? []).map((row) => ({
    choice: row.choice,
    ...(row.price !== null ? { price: row.price } : {}),
    ...(row.wish ? { wish: row.wish } : {}),
    updatedAt: row.updatedAt,
  }));
}
