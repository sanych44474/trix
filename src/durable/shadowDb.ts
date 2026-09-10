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
 * always 0 and any `RETURNING` clause always resolves to nothing — a caller that branches on
 * either would see "nothing happened," never a false "it worked." No call reachable from the
 * scheduler's per-user reminder path does either (checked: the two `RETURNING id` sites in this
 * codebase — injuries, trainer_templates — are both user-initiated bot commands, not scheduler
 * code). If a future write path needs shadowed RETURNING/meta fidelity, extend this rather than
 * silently trusting a fabricated value. */
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
      return null;
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
