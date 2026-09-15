// Product-analytics rollup storage (roadmap item 4 / docs/slos.md §4) — a small pre-aggregated
// table so retention/funnel/cohort queries never re-scan the full user history at dashboard-load
// time. Populated once per day by dailyMetricsRollup.ts; read back here for the future Grafana
// JSON API and for tests.
import { type DB } from "./shared";

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
      `INSERT INTO daily_metrics (date, metric, dims, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(date, metric, dims) DO UPDATE SET value = excluded.value`,
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
    ? "SELECT date, metric, dims, value FROM daily_metrics WHERE date >= ? AND date <= ? AND metric = ? ORDER BY date ASC"
    : "SELECT date, metric, dims, value FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC, metric ASC";
  const stmt = metric ? db.prepare(sql).bind(fromDate, toDate, metric) : db.prepare(sql).bind(fromDate, toDate);
  const r = await stmt.all<DailyMetricRow>();
  return r.results ?? [];
}

/** Telemetry-style cleanup — daily_metrics is deliberately kept indefinitely per docs/slos.md §6
 * (long-running trend panels need history that outlives a single table's prune cycle), so this
 * exists for completeness/ops use, not wired into the routine weekly prune pass. */
export async function pruneDailyMetricsBefore(db: DB, beforeDate: string): Promise<void> {
  await db.prepare("DELETE FROM daily_metrics WHERE date < ?").bind(beforeDate).run();
}
