// v2-native daily-metrics rollup storage (Domain 9 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of src/db/repos/dailyMetrics.ts:
// same exported names/signatures — reads/writes ONLY v2_daily_metrics (migrations/0070_v2_long_tail.sql;
// column is `dimensions`, not legacy's `dims`, but otherwise an identical shape — see that
// migration's CREATE TABLE).
import { type DB } from "../../db/repos/shared";

export interface DailyMetricRow {
  date: string;
  metric: string;
  dims: string; // JSON, low-cardinality — kept as the raw string; callers that need to filter by
  // a dim key do so via the `dims` column directly rather than round-tripping through JSON.parse
  // on every row of a potentially large read.
  value: number;
}

export async function upsertDailyMetric(db: DB, date: string, metric: string, dims: Record<string, string>, value: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_daily_metrics (date, metric, dimensions, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(date, metric, dimensions) DO UPDATE SET value = excluded.value`,
    )
    .bind(date, metric, JSON.stringify(dims), value)
    .run();
}

/** Batched write for one rollup pass — one date, many metrics. Sequential awaits (not
 * db.batch): the row count per day is small (§4 lists ~14 metrics) and this only ever runs once
 * a day from the scheduler, not on a request path where latency matters. */
export async function upsertDailyMetrics(db: DB, date: string, rows: { metric: string; dims?: Record<string, string>; value: number }[]): Promise<void> {
  for (const row of rows) {
    await upsertDailyMetric(db, date, row.metric, row.dims ?? {}, row.value);
  }
}

export async function getDailyMetrics(db: DB, fromDate: string, toDate: string, metric?: string): Promise<DailyMetricRow[]> {
  const sql = metric
    ? "SELECT date, metric, dimensions AS dims, value FROM v2_daily_metrics WHERE date >= ? AND date <= ? AND metric = ? ORDER BY date ASC"
    : "SELECT date, metric, dimensions AS dims, value FROM v2_daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC, metric ASC";
  const stmt = metric ? db.prepare(sql).bind(fromDate, toDate, metric) : db.prepare(sql).bind(fromDate, toDate);
  const r = await stmt.all<DailyMetricRow>();
  return r.results ?? [];
}

/** Telemetry-style cleanup — v2_daily_metrics is deliberately kept indefinitely per
 * docs/slos.md §6 (long-running trend panels need history that outlives a single table's prune
 * cycle), so this exists for completeness/ops use, not wired into the routine weekly prune pass. */
export async function pruneDailyMetricsBefore(db: DB, beforeDate: string): Promise<void> {
  await db.prepare("DELETE FROM v2_daily_metrics WHERE date < ?").bind(beforeDate).run();
}
