// Observation log for the scheduler's Durable-Object dry-run phase (migrations/0060). Purely
// write-side from the app's perspective -- nothing in the running bot reads this back; it exists
// for a human (or scripts/verify-scheduler-dryrun.mjs) to compare the DO path against the cron
// path while a cutover flag is off. Moved here from the removed legacy repo layer.
import { nowIso, type DB } from "../adapters/d1/shared";

export type DryRunSource = "user" | "squad" | "global";
export type DryRunKind = "send" | "write";

export async function logDryRun(db: DB, source: DryRunSource, entityId: number, kind: DryRunKind, detail: unknown): Promise<void> {
  await db
    .prepare("INSERT INTO scheduler_dryrun_log (source, entityId, kind, detail, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(source, entityId, kind, JSON.stringify(detail), nowIso())
    .run();
}
