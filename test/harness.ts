// Handler test harness: a REAL in-memory SQLite (node:sqlite) wrapped in the D1 interface,
// with the schema built from the actual migration files, plus a fake grammY context that
// records outgoing messages. This lets us drive bot.ts handlers end-to-end against a true DB
// — the untested layer where the session/routing bugs live — without mocking SQL semantics.
//
// Requires the --experimental-sqlite node flag (set in the "test" npm script).
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// D1 lets a query reuse a numbered placeholder (?1) multiple times bound to a single value —
// several repos.ts queries do this deliberately (e.g. userStatCounts: one userId, five
// sub-selects). node:sqlite's positional binding instead expects one argument PER OCCURRENCE
// and throws "column index out of range" otherwise. Rewrite ?N to plain ? and duplicate the
// bound value at each occurrence, so real production queries don't need a test-only variant.
function expandNumberedPlaceholders(sql: string): { sql: string; refs: number[] } | null {
  if (!/\?\d/.test(sql)) return null;
  const refs: number[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n: string) => {
    refs.push(Number(n) - 1);
    return "?";
  });
  return { sql: rewritten, refs };
}

// One bound statement. node:sqlite is synchronous; D1 callers await the results (awaiting a
// non-promise is fine), so we can return plain values.
class Stmt {
  private expanded: { sql: string; refs: number[] } | null;
  constructor(
    private raw: DatabaseSync,
    private sql: string,
    private args: unknown[] = [],
  ) {
    this.expanded = expandNumberedPlaceholders(sql);
  }
  private bound(): unknown[] {
    return this.expanded ? this.expanded.refs.map((i) => this.args[i]) : this.args;
  }
  private text(): string {
    return this.expanded ? this.expanded.sql : this.sql;
  }
  bind(...args: unknown[]) {
    return new Stmt(this.raw, this.sql, args);
  }
  first<T = unknown>(): T | null {
    return (this.raw.prepare(this.text()).get(...(this.bound() as never[])) as T) ?? null;
  }
  all<T = unknown>(): { results: T[] } {
    return { results: this.raw.prepare(this.text()).all(...(this.bound() as never[])) as T[] };
  }
  run() {
    const info = this.raw.prepare(this.text()).run(...(this.bound() as never[]));
    return { meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid), rows_written: info.changes } };
  }
}

// Minimal D1Database over node:sqlite — the subset repos.ts uses (prepare/bind/first/all/run + batch).
class FakeD1 {
  constructor(public raw: DatabaseSync) {}
  prepare(sql: string) {
    return new Stmt(this.raw, sql);
  }
  async batch(stmts: Stmt[]) {
    this.raw.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.run());
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  dump<T = unknown>(sql: string, ...args: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(args as never[])) as T[];
  }
}

// Extract only DDL (CREATE/ALTER/DROP) from every migration — skips the multi-MB data seeds
// (exercise catalog, plan bank) we don't need, and tolerates the known migration-tracker drift
// (duplicate ADD COLUMN across files) by ignoring "already exists" errors.
const DDL_RE = /(?:CREATE(?:\s+UNIQUE)?\s+(?:TABLE|INDEX)(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)(?:\s+IF\s+EXISTS)?)[\s\S]*?;/gi;

export function newDb(): FakeD1 {
  const raw = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    // Strip `-- line comments` first: a ";" inside a comment would otherwise truncate the
    // lazy DDL match (0014 has "...trainer/owner; never..." mid-CREATE).
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8").replace(/--[^\n]*/g, "");
    for (const stmt of sql.match(DDL_RE) ?? []) {
      try {
        raw.exec(stmt);
      } catch (e) {
        const msg = String(e);
        if (!/already exists|duplicate column/i.test(msg)) throw new Error(`${f}: ${msg}\n${stmt.slice(0, 120)}`);
      }
    }
  }
  return new FakeD1(raw);
}

export interface Sent {
  to: number | "self";
  text: string;
  hasKb: boolean;
}

// Fake MyContext: captures every outgoing message, runs waitUntil work inline-collectable.
export function makeCtx(db: FakeD1, user: Record<string, unknown>, env: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const deferred: Promise<unknown>[] = [];
  const chatId = (user.chatId as number) ?? (user._id as number);
  const ctx = {
    env: { DB: db, TELEGRAM_BOT_TOKEN: "test", ...env },
    db,
    user,
    waitUntil: (p: Promise<unknown>) => { deferred.push(Promise.resolve(p).catch(() => {})); },
    reply: async (text: string, extra?: { reply_markup?: unknown }) => {
      sent.push({ to: "self", text, hasKb: !!(extra?.reply_markup && "inline_keyboard" in (extra.reply_markup as object)) });
    },
    replyWithChatAction: async () => {},
    replyWithPhoto: async () => {},
    replyWithDocument: async () => {},
    answerCallbackQuery: async () => {},
    editMessageReplyMarkup: async () => {},
    chat: { id: chatId, type: "private" },
    from: { id: user._id as number, is_bot: false },
    api: {
      sendMessage: async (to: number, text: string, extra?: { reply_markup?: unknown }) => {
        sent.push({ to, text, hasKb: !!(extra?.reply_markup && "inline_keyboard" in (extra.reply_markup as object)) });
      },
      sendPhoto: async () => {},
    },
  };
  return { ctx, sent, flush: async () => { await Promise.all(deferred); } };
}
