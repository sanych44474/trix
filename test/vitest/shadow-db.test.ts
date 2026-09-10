// shadowD1 is the write-interception layer the dry-run DO scheduler runs the REAL processUser
// logic against. Needs a real D1Database to wrap (not the node:sqlite harness), so this lives
// in the vitest-plugin pool.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { shadowD1 } from "../../src/durable/shadowDb";

describe("shadowD1", () => {
  it("reads pass straight through to the real database", async () => {
    await env.DB.prepare("INSERT INTO users (id, chatId, lang, onboarded, profile, session, sessionMode, createdAt, updatedAt) VALUES (?, ?, ?, 0, '{}', '{}', 'idle', ?, ?)")
      .bind(101, 101, "en", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();
    const writes: unknown[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const row = await shadow.prepare("SELECT lang FROM users WHERE id = ?").bind(101).first<{ lang: string }>();
    expect(row?.lang).toBe("en");
    expect(writes).toEqual([]);
  });

  it("writes are logged, never applied — the real row is unchanged", async () => {
    await env.DB.prepare("INSERT INTO users (id, chatId, lang, onboarded, profile, session, sessionMode, createdAt, updatedAt) VALUES (?, ?, ?, 0, '{}', '{}', 'idle', ?, ?)")
      .bind(102, 102, "en", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();
    const writes: { sql: string; params: unknown[] }[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const res = await shadow.prepare("UPDATE users SET lang = ? WHERE id = ?").bind("uk", 102).run();
    expect(res.success).toBe(true);
    expect(res.meta.changes).toBe(0); // honest: nothing really changed
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/^UPDATE users/);
    expect(writes[0].params).toEqual(["uk", 102]);
    // The real row is untouched — this is the whole point.
    const real = await env.DB.prepare("SELECT lang FROM users WHERE id = ?").bind(102).first<{ lang: string }>();
    expect(real?.lang).toBe("en");
  });

  it("a write disguised as a read (RETURNING via .first()) is still intercepted", async () => {
    const writes: unknown[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const row = await shadow
      .prepare("INSERT INTO users (id, chatId, lang, onboarded, profile, session, sessionMode, createdAt, updatedAt) VALUES (?, ?, ?, 0, '{}', '{}', 'idle', ?, ?) RETURNING id")
      .bind(103, 103, "en", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .first<{ id: number }>();
    expect(row).toBeNull(); // never really ran, so there is no id to return
    expect(writes).toHaveLength(1);
    const real = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(103).first();
    expect(real).toBeNull(); // confirms nothing was actually inserted
  });

  it("batch() intercepts every statement individually", async () => {
    const writes: { sql: string }[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push({ sql: w.sql }));
    await shadow.batch([
      shadow.prepare("UPDATE users SET lang = ? WHERE id = ?").bind("uk", 104),
      shadow.prepare("DELETE FROM users WHERE id = ?").bind(104),
    ]);
    expect(writes.map((w) => w.sql.split(" ")[0])).toEqual(["UPDATE", "DELETE"]);
  });
});
