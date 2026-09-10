// Demonstrates the exact gap the hand-rolled harness (test/harness.ts, built on node:sqlite)
// cannot close by construction: `res.meta.changes` on an INSERT/DELETE and `db.batch()` are
// D1's OWN result shape, not something a different SQLite binding reproduces just by being
// SQLite-compatible. This runs the SAME repo functions (src/db/repos/squads.ts) against a REAL
// D1 binding inside workerd, instead of the harness's in-memory node:sqlite.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteSquad, getSquad, joinSquad, leaveSquad, upsertSquad } from "../../src/db/repos";

describe("squad membership against real D1", () => {
  it("joinSquad: meta.changes distinguishes a fresh join from an ON CONFLICT DO NOTHING no-op", async () => {
    const chat = -3001;
    await upsertSquad(env.DB, chat, "Real D1", 1);
    expect(await joinSquad(env.DB, chat, 1)).toBe(true); // INSERT actually wrote a row
    expect(await joinSquad(env.DB, chat, 1)).toBe(false); // ON CONFLICT DO NOTHING wrote nothing
  });

  it("leaveSquad: meta.changes distinguishes a real delete from a no-op", async () => {
    const chat = -3002;
    await upsertSquad(env.DB, chat, "Real D1", 1);
    await joinSquad(env.DB, chat, 2);
    expect(await leaveSquad(env.DB, chat, 2)).toBe(true); // row existed → deleted
    expect(await leaveSquad(env.DB, chat, 2)).toBe(false); // already gone → nothing to delete
  });

  it("deleteSquad: db.batch() removes rows from both tables together", async () => {
    const chat = -3003;
    await upsertSquad(env.DB, chat, "Real D1", 1);
    await joinSquad(env.DB, chat, 1);
    await deleteSquad(env.DB, chat);
    expect(await getSquad(env.DB, chat)).toBeNull();
  });
});
