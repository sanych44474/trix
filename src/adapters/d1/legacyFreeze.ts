// Legacy-write guard for the completed v2 cutover (docs/adr/0001-v2-seams-and-staged-cutover.md).
// Every domain now reads/writes v2_* tables through the modules in this directory; the legacy
// tables below are kept only until a separate, explicit deletion decision is made. Before that
// happens, a stray call site nobody caught during the migration must fail LOUDLY, not silently
// keep writing to a table the rest of the app has stopped reading -- that's the failure mode
// this guard exists to prevent.
//
// Off by default (CUTOVER_LEGACY_FROZEN="0" in wrangler.toml). When flipped to "1", every D1
// write (INSERT/UPDATE/DELETE, including inside db.batch(), since a batch's statements are each
// created via the same intercepted prepare()) against a legacy table throws instead of
// executing. SELECTs are never blocked -- a missed legacy READ degrades to stale data, not a
// crash, and blocking reads would make rollback to the legacy Mini App bundle (/app) impossible.
//
// This list is every table created by a pre-v2 migration (migrations/0001-0068), i.e. every
// table verify-v2-backfill.mjs's parity checks compare against a v2_* counterpart, PLUS a few
// (client_billing, trainer_reviews) that earlier domain work found were already dead/unused --
// included anyway since freezing a table nothing writes to is a safe no-op, not a hazard.
//
// Deliberately EXCLUDED: `scheduler_dryrun_log`. That table belongs to the separate, still-active
// Durable-Object-cutover safety net (src/durable/cutover.ts) -- an unrelated migration effort
// that must keep writing to it regardless of this migration's status.
const LEGACY_TABLES = [
  "achievements", "admin_audit", "ai_cache", "ai_call_logs", "ai_usage", "body_logs",
  "buddy_duels", "challenges", "client_billing", "client_cards", "client_note_history",
  "client_notes", "client_questions", "client_requests", "config", "daily_checkins",
  "daily_metrics", "error_logs", "event_counts", "exercise_translations", "exercise_videos",
  "exercises", "feedback", "food_cache", "food_corrections", "food_translations",
  "idempotency_keys", "injuries", "meal_plans", "messages", "notification_outbox",
  "nutrition_logs", "plan_adjustments", "plan_bank", "plan_change_log", "plan_source_logs",
  "plans", "progress_photos", "rest_timers", "seen_updates", "sessions", "settings",
  "shared_programs", "squad_members", "squads", "step_logs", "strength_records",
  "trainer_prospects", "trainer_reviews", "trainer_templates", "trainers",
  "user_exercise_videos", "users", "water_logs", "workout_logs",
] as const;

const WRITE_PATTERN = new RegExp(
  `\\b(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+["\`]?(${LEGACY_TABLES.join("|")})["\`]?\\b`,
  "i",
);

export class LegacyWriteBlockedError extends Error {
  constructor(sql: string) {
    super(`Legacy write blocked by CUTOVER_LEGACY_FROZEN: ${sql.slice(0, 200)}`);
    this.name = "LegacyWriteBlockedError";
  }
}

/** Wraps `db` so any write against a legacy table throws instead of executing. Read-only
 * (SELECT, PRAGMA, ...) statements pass through unchanged. Call `onBlocked` for structured
 * logging before the throw propagates -- the caller decides how (logError, etc.), this module
 * has no opinion on logging shape. */
export function freezeLegacyWrites(db: D1Database, onBlocked: (sql: string) => void): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string): D1PreparedStatement => {
          if (WRITE_PATTERN.test(sql)) {
            onBlocked(sql);
            throw new LegacyWriteBlockedError(sql);
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Applies the guard to `env.DB` when `env.CUTOVER_LEGACY_FROZEN === "1"` (default "0" --
 * see wrangler.toml), otherwise returns `env` unchanged. Call once at the top of every entry
 * point (fetch, scheduled, each Durable Object's constructor) so nothing downstream needs to
 * know the flag exists. `E` is generic over the two `Env`-shaped types this repo has (the plain
 * `Env` and Durable Object bindings) without this module needing to import either. */
export function withLegacyFreeze<E extends { DB: D1Database; CUTOVER_LEGACY_FROZEN: string }>(
  env: E,
  logBlocked: (sql: string) => void,
): E {
  if (env.CUTOVER_LEGACY_FROZEN !== "1") return env;
  return { ...env, DB: freezeLegacyWrites(env.DB, logBlocked) };
}
