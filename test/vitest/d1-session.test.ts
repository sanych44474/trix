// The Sessions API against a real D1 in workerd: a session reads its own writes and hands out a
// bookmark that a later session can be anchored at (adapters/d1/session.ts).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { openReadSession } from "../../src/adapters/d1/session";

describe("D1 read sessions", () => {
  it("reads its own writes, returns a bookmark, and a bookmarked session sees them too", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.exec("CREATE TABLE IF NOT EXISTS t_session (id INTEGER PRIMARY KEY, v TEXT)");
    const s1 = openReadSession(db, null)!;
    expect(s1).not.toBeNull();
    await s1.db.prepare("INSERT INTO t_session (v) VALUES (?)").bind("a").run();
    const own = await s1.db.prepare("SELECT COUNT(*) AS n FROM t_session").first<{ n: number }>();
    expect(own?.n).toBeGreaterThan(0);
    const bm = s1.bookmark();
    expect(typeof bm).toBe("string");
    const s2 = openReadSession(db, bm)!;
    const seen = await s2.db.prepare("SELECT COUNT(*) AS n FROM t_session WHERE v = 'a'").first<{ n: number }>();
    expect(seen?.n).toBeGreaterThan(0);
  });
});
