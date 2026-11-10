// scheduler_dryrun_log (migrations/0060) held what the scheduler Durable Objects would have sent
// while they shadow-ran next to the cron. Nothing writes it any more (ADR-0015). The rows that
// are left hold message texts, so the weekly prune stays until a migration drops the table.
import type { DB } from "./shared";

/** Drops dry-run rows older than `cutoffIso`. */
export async function pruneDryRunLog(db: DB, cutoffIso: string): Promise<void> {
  await db.prepare("DELETE FROM scheduler_dryrun_log WHERE createdAt < ?").bind(cutoffIso).run();
}
