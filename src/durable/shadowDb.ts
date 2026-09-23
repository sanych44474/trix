// A D1Database wrapper that reads for real but intercepts writes — logs what a write WOULD have
// done instead of executing it. Built for the scheduler's DO dry-run phase: it lets the exact
// same, unmodified decision code (processUser and everything it calls — updateUser,
// awardAchievement, recordAdjustment, ...) run against REAL current data without risking a
// second, untested code path corrupting the live reminders.sent dedup state the old cron path
// still owns. This is deliberately a low, universal interception point (one class, here) rather
// than hand-gating dozens of individual write call sites scattered through a 700+ line function
// — the latter is exactly the kind of thing that silently drifts the next time someone adds a
// write inside processUser and forgets the dry-run guard.
//
// Classification is by the query's leading SQL keyword. Every write in this codebase is a plain
// INSERT/UPDATE/DELETE/REPLACE (verified: no CTEs, no multi-statement strings) — SELECT/PRAGMA/
// WITH pass straight through to the real database.
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

export interface ShadowWrite {
  sql: string;
  params: unknown[];
}

/** Known, honest limitation: a shadowed write never really executes, so `meta.changes` is
 * always 0 — a caller that branches on it sees "nothing happened," never a false "it worked."
 *
 * `INSERT ... RETURNING id` is the one exception, and it is deliberate. Once processUser's sends
 * were routed through the notification outbox, `enqueueNotification` (INSERT ... RETURNING id)
 * became reachable from the scheduler's per-user path: returning nothing made it read as "this was
 * a duplicate, do not deliver", which silently dropped EVERY outbox-routed send from the dry-run
 * log — the dry run would have under-reported exactly the thing the cutover comparison exists to
 * measure. So a shadowed INSERT..RETURNING now yields a synthetic NEGATIVE id (see
 * nextShadowId): real rowids are positive, so a fabricated one can never be mistaken for a real
 * row, and any follow-up UPDATE keyed on it is itself shadowed.
 *
 * The residual inaccuracy is the opposite, safer direction: `ON CONFLICT DO NOTHING` cannot be
 * evaluated without really inserting, so a genuine duplicate looks like a fresh insert and the dry
 * run may log a send the real path would have suppressed. Over-reporting is the tolerable error
 * here; under-reporting would make parity look clean while the live path sent more. */
let shadowIdCounter = 0;
const nextShadowId = () => --shadowIdCounter;
const RETURNING_RE = /\bRETURNING\b/i;
class ShadowPreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];
  constructor(
    private readonly real: D1Database,
    private readonly sql: string,
    private readonly onWrite: (w: ShadowWrite) => void,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  private isWrite(): boolean {
    return WRITE_RE.test(this.sql);
  }

  private realStmt(): D1PreparedStatement {
    return this.real.prepare(this.sql).bind(...this.params);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.isWrite()) {
      this.onWrite({ sql: this.sql, params: this.params });
      return shadowResult<T>();
    }
    return this.realStmt().run<T>();
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.isWrite()) {
      this.onWrite({ sql: this.sql, params: this.params });
      return shadowResult<T>();
    }
    return this.realStmt().all<T>();
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    if (this.isWrite()) {
      this.onWrite({ sql: this.sql, params: this.params });
      if (!RETURNING_RE.test(this.sql)) return null;
      // Only `id` is synthesized — that is the only RETURNING column any scheduler-reachable
      // write asks for. A different column would come back undefined, which reads as "nothing
      // happened" exactly as before, rather than as a wrong value.
      const id = nextShadowId();
      return (colName ? (colName === "id" ? id : null) : { id }) as T;
    }
    return colName ? this.realStmt().first<T>(colName) : this.realStmt().first<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T>(options?: { columnNames?: boolean }): Promise<unknown> {
    if (this.isWrite()) {
      this.onWrite({ sql: this.sql, params: this.params });
      return options?.columnNames ? [[]] : [];
    }
    return this.realStmt().raw<T>(options as never);
  }
}

function shadowResult<T>(): D1Result<T> {
  return {
    success: true,
    meta: { duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 },
    results: [],
  };
}

/** A D1Database whose reads are real and whose writes are logged, not executed. `onWrite` fires
 * synchronously for every intercepted statement (including each one inside a `batch()`); the
 * caller decides what to do with the log (scheduler_dryrun_log, console, both). */
export function shadowD1(real: D1Database, onWrite: (w: ShadowWrite) => void): D1Database {
  return {
    prepare(query: string) {
      return new ShadowPreparedStatement(real, query, onWrite);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      // Every statement in this codebase's batch() calls is a write (verified: db/repos/*.ts).
      // Run each through prepare() (not directly against `real`) so the SAME classification and
      // interception applies here too, rather than assuming the whole batch is safe to execute.
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push(await (s as D1PreparedStatement).run<T>());
      return out;
    },
    async exec(query: string) {
      if (WRITE_RE.test(query)) {
        onWrite({ sql: query, params: [] });
        return { count: 0, duration: 0 };
      }
      return real.exec(query);
    },
    withSession(_constraintOrBookmark?: D1SessionConstraint | D1SessionBookmark) {
      // Sessions are not used anywhere in this codebase (grep confirmed) — real.withSession()
      // would bypass the write interception above entirely, so refuse rather than silently
      // create an escape hatch the day someone does start using them.
      throw new Error("shadowD1: withSession() is not supported by the dry-run shadow");
    },
    async dump() {
      throw new Error("shadowD1: dump() is not supported by the dry-run shadow");
    },
  } as D1Database;
}
