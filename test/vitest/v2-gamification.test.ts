// Domain 8 v2-native repo (src/adapters/d1/v2Gamification.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-gamification.test.ts) can't promise `meta.changes`
// on INSERT/DELETE or `db.batch()` atomicity actually match D1's own result shape (same reasoning
// as test/vitest/squad-repo.test.ts and test/vitest/v2-trainer.test.ts). This file targets the two
// consistency invariants the migration plan calls out for this domain specifically:
//
//   1. Buddy pairing is bidirectional. This domain deliberately does NOT own the pairing write
//      path (see v2Gamification.ts's header comment: the live write path is bot.ts's
//      `/start buddy_<id>` handler calling v2Users.updateUser, Domain 1's code, as TWO separate
//      awaited calls — same as legacy always did). What this domain owns is the READ side
//      (allBuddyPairs) that must tolerate exactly the transient inconsistency two separate writes
//      can leave behind (a crash/retry between them) without surfacing a stale, one-sided link as
//      a real pair.
//   2. Squad membership must stay consistent: joinSquad/leaveSquad are each a single atomic
//      statement (meta.changes distinguishes a real write from a no-op — not guaranteed by a
//      different SQLite binding just for being SQLite-compatible), and deleteSquad's db.batch()
//      must remove v2_squad_members + v2_squads together so no member row is ever left pointing at
//      a squadId with no v2_squads parent.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getOrCreateUser, updateUser } from "../../src/adapters/d1/v2Users";
import {
  allBuddyPairs,
  deleteSquad,
  getSquad,
  joinSquad,
  leaveSquad,
  squadsForUser,
  upsertSquad,
} from "../../src/adapters/d1/v2Gamification";

describe("v2Gamification: allBuddyPairs — mutuality self-join on real D1", () => {
  it("a completed mutual pairing (two separate updateUser calls, same as bot.ts) surfaces as one pair", async () => {
    await getOrCreateUser(env.DB, 800, 800, "en");
    await getOrCreateUser(env.DB, 801, 801, "en");
    await updateUser(env.DB, 800, { profile: { buddyId: 801 } });
    await updateUser(env.DB, 801, { profile: { buddyId: 800 } });

    const pairs = await allBuddyPairs(env.DB);
    expect(pairs).toEqual([{ userA: 800, userB: 801 }]);
  });

  it("a stale one-sided link left by only ONE of the two writes landing is excluded, not surfaced as a pair", async () => {
    await getOrCreateUser(env.DB, 810, 810, "en");
    await getOrCreateUser(env.DB, 811, 811, "en");
    // Simulates the exact gap bot.ts's handler can leave: side A's write lands, side B's never
    // runs (crash, or B was never fetched) — same "stale, one-sided" case the legacy comment on
    // allBuddyPairs already documents.
    await updateUser(env.DB, 810, { profile: { buddyId: 811 } });

    const pairs = await allBuddyPairs(env.DB);
    expect(pairs.find((p) => p.userA === 810 || p.userB === 810)).toBeUndefined();
  });

  it("re-pairing 810 with a NEW buddy after the stale link above leaves exactly one true pair", async () => {
    await getOrCreateUser(env.DB, 812, 812, "en");
    await updateUser(env.DB, 810, { profile: { buddyId: 812 } });
    await updateUser(env.DB, 812, { profile: { buddyId: 810 } });

    const pairs = await allBuddyPairs(env.DB);
    const involving810 = pairs.filter((p) => p.userA === 810 || p.userB === 810);
    expect(involving810).toEqual([{ userA: 810, userB: 812 }]);
  });
});

describe("v2Gamification: squad membership — real D1 meta.changes + batch atomicity", () => {
  it("joinSquad: meta.changes distinguishes a fresh join from an ON CONFLICT DO NOTHING no-op", async () => {
    await getOrCreateUser(env.DB, 820, 820, "en");
    const chat = -8001;
    await upsertSquad(env.DB, chat, "Real D1", 820);
    expect(await joinSquad(env.DB, chat, 820)).toBe(true); // INSERT actually wrote a row
    expect(await joinSquad(env.DB, chat, 820)).toBe(false); // ON CONFLICT DO NOTHING wrote nothing
  });

  it("leaveSquad: meta.changes distinguishes a real delete from a no-op", async () => {
    await getOrCreateUser(env.DB, 821, 821, "en");
    await getOrCreateUser(env.DB, 822, 822, "en");
    const chat = -8002;
    await upsertSquad(env.DB, chat, "Real D1", 821);
    await joinSquad(env.DB, chat, 822);
    expect(await leaveSquad(env.DB, chat, 822)).toBe(true); // row existed → deleted
    expect(await leaveSquad(env.DB, chat, 822)).toBe(false); // already gone → nothing to delete
  });

  it("deleteSquad: db.batch() removes v2_squad_members + v2_squads together — no orphaned membership row", async () => {
    await getOrCreateUser(env.DB, 823, 823, "en");
    const chat = -8003;
    await upsertSquad(env.DB, chat, "Real D1", 823);
    await joinSquad(env.DB, chat, 823);

    await deleteSquad(env.DB, chat);

    expect(await getSquad(env.DB, chat)).toBeNull();
    // squadsForUser must never report membership in a squad that no longer exists — this is only
    // guaranteed if the batch actually removed BOTH rows together (never one without the other).
    expect(await squadsForUser(env.DB, 823)).toEqual([]);
    const orphan = await env.DB
      .prepare("SELECT 1 FROM v2_squad_members WHERE squadId = ?")
      .bind(chat)
      .first();
    expect(orphan).toBeNull();
  });
});
