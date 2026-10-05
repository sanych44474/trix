// shadowD1 is the write-interception layer the dry-run DO scheduler runs the REAL processUser
// logic against. Needs a real D1Database to wrap (not the node:sqlite harness), so this lives
// in the vitest-plugin pool.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { shadowD1 } from "../../src/durable/shadowDb";

describe("shadowD1", () => {
  it("reads pass straight through to the real database", async () => {
    await env.DB.prepare("INSERT INTO v2_settings (key, value) VALUES (?, ?)").bind("shadow_101", "en").run();
    const writes: unknown[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const row = await shadow.prepare("SELECT value FROM v2_settings WHERE key = ?").bind("shadow_101").first<{ value: string }>();
    expect(row?.value).toBe("en");
    expect(writes).toEqual([]);
  });

  it("writes are logged, never applied — the real row is unchanged", async () => {
    await env.DB.prepare("INSERT INTO v2_settings (key, value) VALUES (?, ?)").bind("shadow_102", "en").run();
    const writes: { sql: string; params: unknown[] }[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const res = await shadow.prepare("UPDATE v2_settings SET value = ? WHERE key = ?").bind("uk", "shadow_102").run();
    expect(res.success).toBe(true);
    expect(res.meta.changes).toBe(0); // honest: nothing really changed
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/^UPDATE v2_settings/);
    expect(writes[0].params).toEqual(["uk", "shadow_102"]);
    // The real row is untouched — this is the whole point.
    const real = await env.DB.prepare("SELECT value FROM v2_settings WHERE key = ?").bind("shadow_102").first<{ value: string }>();
    expect(real?.value).toBe("en");
  });

  it("a write disguised as a read (RETURNING via .first()) is intercepted and yields a synthetic negative id", async () => {
    const writes: unknown[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push(w));
    const row = await shadow
      .prepare("INSERT INTO v2_settings (key, value) VALUES (?, ?) RETURNING rowid AS id")
      .bind("shadow_103", "en")
      .first<{ id: number }>();
    // Returning null here used to read as "that insert was a duplicate" to enqueueNotification,
    // which silently dropped every outbox-routed send from the dry-run log. A negative id can
    // never collide with a real rowid, so the caller proceeds without the shadow ever claiming a
    // real row exists. See the contract note in src/durable/shadowDb.ts.
    expect(row?.id).toBeLessThan(0);
    expect(writes).toHaveLength(1);
    const real = await env.DB.prepare("SELECT key FROM v2_settings WHERE key = ?").bind("shadow_103").first();
    expect(real).toBeNull(); // confirms nothing was actually inserted — still the whole point
  });

  it("batch() intercepts every statement individually", async () => {
    const writes: { sql: string }[] = [];
    const shadow = shadowD1(env.DB, (w) => writes.push({ sql: w.sql }));
    await shadow.batch([
      shadow.prepare("UPDATE v2_settings SET value = ? WHERE key = ?").bind("uk", "shadow_104"),
      shadow.prepare("DELETE FROM v2_settings WHERE key = ?").bind("shadow_104"),
    ]);
    expect(writes.map((w) => w.sql.split(" ")[0])).toEqual(["UPDATE", "DELETE"]);
  });
});
