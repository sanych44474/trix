// Per-DO-type cutover switch. Default is OFF (dry-run) everywhere — deploying this code changes
// NOTHING about what actually sends or writes; the cron path stays the sole real actor until
// each flag is explicitly turned on. This is the ONE thing that decides, for real, whether a
// given DO type owns its jobs for real or is still shadow-running: both the cron path (which
// must STOP doing real work once a type cuts over, or the two would double-send) and that DO
// type's own alarm (which starts doing real work once its flag is on) read the exact same flag
// through this module, so they can never disagree about who currently owns the work.
//
// Deliberately per-type, not one global switch: cutting over user reminders, watching it for a
// few days, THEN squads, THEN the global jobs is a materially safer rollout than an all-or-
// nothing flip — and each type has a different blast radius if something's wrong with it.
//
// Turning one on is a single D1 write and nothing else — no code change, no redeploy:
//   npx wrangler d1 execute trix --remote --command \
//     "INSERT INTO settings (key, value) VALUES ('scheduler_cutover_user', '1') \
//      ON CONFLICT(key) DO UPDATE SET value = excluded.value"
// (swap the key for _squad / _global.) That write is a live mutation like any other
// `d1 execute --remote` — same per-session approval rule as always.
import { getSetting } from "../db/repos";

export type CutoverKind = "user" | "squad" | "global";

const SETTING_KEY: Record<CutoverKind, string> = {
  user: "scheduler_cutover_user",
  squad: "scheduler_cutover_squad",
  global: "scheduler_cutover_global",
};

export async function isCutOver(db: D1Database, kind: CutoverKind): Promise<boolean> {
  return (await getSetting(db, SETTING_KEY[kind]).catch(() => null)) === "1";
}
