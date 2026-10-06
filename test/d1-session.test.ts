import { test } from "node:test";
import assert from "node:assert/strict";
import { openReadSession } from "../src/adapters/d1/session";

function fakeDb() {
  const calls: unknown[] = [];
  const db = {
    withSession(c?: string) {
      calls.push(c);
      if (c === "bad-bookmark-that-throws") throw new Error("invalid bookmark");
      return { prepare: (q: string) => ({ q, via: c }), batch: async () => [], getBookmark: () => "bm-2" };
    },
    exec: async () => ({}),
    dump: async () => new ArrayBuffer(0),
  };
  return { db: db as unknown as D1Database, calls };
}

test("no bookmark → session starts at the primary; the new bookmark is returned", () => {
  const { db, calls } = fakeDb();
  const s = openReadSession(db, null)!;
  assert.equal(calls[0], "first-primary");
  assert.equal((s.db.prepare("SELECT 1") as unknown as { via: string }).via, "first-primary");
  assert.equal(s.bookmark(), "bm-2");
});

test("a client bookmark anchors the session; garbage or a rejected bookmark falls back to the primary", () => {
  const a = fakeDb();
  openReadSession(a.db, "00000001-abc:def");
  assert.equal(a.calls[0], "00000001-abc:def");
  const b = fakeDb();
  openReadSession(b.db, "<script>");
  assert.equal(b.calls[0], "first-primary");
  const c = fakeDb();
  openReadSession(c.db, "bad-bookmark-that-throws");
  assert.deepEqual(c.calls, ["bad-bookmark-that-throws", "first-primary"]);
});

test("a database without the Sessions API (tests, old runtime) is used as is", () => {
  assert.equal(openReadSession({ prepare() {} } as unknown as D1Database, null), null);
});
