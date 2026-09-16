// Domain 7 v2-native repo (src/adapters/d1/v2Trainer.ts) against REAL D1 (workerd) — the
// node:sqlite-backed node:test harness (test/v2-trainer.test.ts) can't promise db.batch()'s
// atomicity guarantees match real D1. This file targets specifically the relationship-consistency
// invariant called out in the migration plan: v2_trainer_relationships is keyed (clientId,
// trainerId), and linkClient()/unlinkClient() must land their DELETE-then-INSERT across
// v2_trainer_relationships + v2_accounts (+ legacy `plans` for unlink) as ONE atomic batch, never
// as separate awaited calls that a crash could interleave and leave the table holding more than
// one 'active' row for the same client (which would make the client-side view — UserDoc.trainerId,
// derived in v2Users.getUser() — and the trainer-side view — listClients()/countClientsOf() —
// disagree about who the client's trainer is).
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getUser } from "../../src/adapters/d1/v2Users";
import { countClientsOf, linkClient, listClients, unlinkClient } from "../../src/adapters/d1/v2Trainer";

// v2_trainers/v2_trainer_relationships/v2_client_cards/etc. all FK accountId -> v2_accounts(id) --
// real D1 enforces it (unlike the node:sqlite harness in some configurations), so every account
// this file references must exist first. This domain doesn't own v2_accounts, so seed it directly
// (same reasoning as test/vitest/v2-nutrition.test.ts's seedAccount).
async function seedAccount(id: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

describe("v2Trainer: linkClient — one batch across v2_trainer_relationships + v2_accounts", () => {
  it("lands the relationship row and the role flip together", async () => {
    await seedAccount(700); // client
    await seedAccount(701); // trainer

    await linkClient(env.DB, 700, 701);

    const edge = await env.DB
      .prepare("SELECT status FROM v2_trainer_relationships WHERE clientId = ? AND trainerId = ?")
      .bind(700, 701)
      .first<{ status: string }>();
    expect(edge?.status).toBe("active");

    const account = await env.DB.prepare("SELECT role FROM v2_accounts WHERE id = ?").bind(700).first<{ role: string }>();
    expect(account?.role).toBe("client");

    const u = await getUser(env.DB, 700);
    expect(u?.trainerId).toBe(701);
  });

  it("re-linking to a different trainer deletes the old edge and inserts the new one atomically — never two active rows", async () => {
    await seedAccount(710); // client
    await seedAccount(711); // trainer A
    await seedAccount(712); // trainer B

    await linkClient(env.DB, 710, 711);
    await linkClient(env.DB, 710, 712);

    const rows = await env.DB
      .prepare("SELECT trainerId FROM v2_trainer_relationships WHERE clientId = ?")
      .bind(710)
      .all<{ trainerId: number }>();
    // Exactly one row survives -- the bidirectional-consistency invariant: both the client-side
    // read (getUser().trainerId) and the trainer-side read (listClients/countClientsOf) must
    // agree, which is only possible if there is never more than one 'active' row per client.
    expect(rows.results).toHaveLength(1);
    expect(rows.results?.[0]?.trainerId).toBe(712);

    const u = await getUser(env.DB, 710);
    expect(u?.trainerId).toBe(712);

    expect(await countClientsOf(env.DB, 711)).toBe(0);
    expect(await countClientsOf(env.DB, 712)).toBe(1);
    const clientsOfA = await listClients(env.DB, 711);
    const clientsOfB = await listClients(env.DB, 712);
    expect(clientsOfA.map((c) => c._id)).toEqual([]);
    expect(clientsOfB.map((c) => c._id)).toEqual([710]);
  });
});

describe("v2Trainer: unlinkClient — one batch across v2_trainer_relationships + v2_accounts + v2_plans", () => {
  it("clears the edge, reverts the role, and deactivates the active plan together", async () => {
    await seedAccount(720); // client
    await seedAccount(721); // trainer
    await linkClient(env.DB, 720, 721);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO v2_plans (accountId, version, schemaVersion, status, source, active, nutrition, createdAt, updatedAt) VALUES (?, 1, 1, 'active', 'ai', 1, '{}', ?, ?)",
    ).bind(720, now, now).run();

    await unlinkClient(env.DB, 720);

    const edge = await env.DB.prepare("SELECT 1 FROM v2_trainer_relationships WHERE clientId = ?").bind(720).first();
    expect(edge).toBeNull();

    const account = await env.DB.prepare("SELECT role FROM v2_accounts WHERE id = ?").bind(720).first<{ role: string }>();
    expect(account?.role).toBe("solo");

    const plan = await env.DB.prepare("SELECT active FROM v2_plans WHERE accountId = ?").bind(720).first<{ active: number }>();
    expect(plan?.active).toBe(0);

    expect(await countClientsOf(env.DB, 721)).toBe(0);
    const u = await getUser(env.DB, 720);
    expect(u?.trainerId).toBeUndefined();
  });
});
