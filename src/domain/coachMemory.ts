// Long-term memory for the AI coach — pure, no DB. "Structured, relevant-only context" per the
// review this closes: rather than a new freeform notes table (which would need its own
// AI-extraction pipeline to fill), this reads what the app ALREADY records with a reason
// attached (domain/progression.ts's ExerciseChange.reason, scheduler.ts's held-week entries —
// see plan_adjustments) and surfaces only the recent, deduplicated, capped subset. "Relevant"
// means recent and non-repeated, not a dump of every adjustment ever made.
export interface AdjustmentRow {
  changes: string; // raw JSON, as stored by recordAdjustment
}

const MAX_REASONS = 4;

/** Distinct reasons from the most recent adjustment rows (rows should already be ordered newest
 * first, matching recentAdjustments' own ORDER BY). A row that fails to parse is skipped, not
 * thrown on -- one malformed historical row must not break the whole coach context. */
export function recentCoachingReasons(rows: AdjustmentRow[], limit = MAX_REASONS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.changes);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      if (out.length >= limit) break;
      const reason = (entry as { reason?: unknown })?.reason;
      if (typeof reason !== "string" || !reason.trim()) continue;
      if (seen.has(reason)) continue;
      seen.add(reason);
      out.push(reason);
    }
  }
  return out;
}
