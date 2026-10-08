// The owner report's numbers come from one loadOwnerSnapshot. Before, the overview section, the
// onboarding section and the Grafana feed each re-ran the same ~15 queries (listChurnedUsers alone
// three times per full report), and the share of active users was printed as "retention".
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { buildOwnerMetrics, buildOwnerReport, loadOwnerSnapshot, orOverview } from "../src/bot/ownerReport";

type Db = ReturnType<typeof newDb>;

/** Counts how many times each SQL text is prepared. */
function counting(db: Db): { db: Db; count: (needle: string) => number } {
  const seen: string[] = [];
  const wrapped = new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop === "prepare") return (sql: string) => { seen.push(sql); return (target as Db).prepare(sql); };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Db;
  return { db: wrapped, count: (needle) => seen.filter((q) => q.includes(needle)).length };
}

async function seed(db: Db) {
  for (const id of [1, 2, 3]) {
    await getOrCreateUser(db, id, id, "en", `U${id}`);
    await updateUser(db, id, { onboarded: true });
  }
}

test("loadOwnerSnapshot: the activity rate is active-7d over onboarded, and says so", async () => {
  const db = newDb();
  await seed(db);
  const snap = await loadOwnerSnapshot(db);
  assert.equal(snap.onboarded, 3);
  assert.equal(snap.activityRate7d, Math.round((snap.active7 / snap.onboarded) * 100));
});

test("the overview and the Grafana feed agree on the same snapshot, and nothing calls it retention", async () => {
  const db = newDb();
  await seed(db);
  const snap = await loadOwnerSnapshot(db);
  const text = await orOverview(db, snap);
  assert.match(text, new RegExp(`activity rate 7d/onb <b>${snap.activityRate7d}%</b>`));
  assert.doesNotMatch(text, /retention 7d/);

  const metrics = await buildOwnerMetrics(db);
  assert.equal(metrics.people.activityRate7d, snap.activityRate7d);
  assert.equal("retentionPct" in metrics.people, false, "the misleading field is gone");
  assert.equal(metrics.people.onboarded, snap.onboarded);
});

test("a full owner report asks for the churned users once, not once per section", async () => {
  const base = newDb();
  await seed(base);
  const c = counting(base);
  await buildOwnerReport(c.db);
  // The overview and the onboarding section both list churned users; they share the snapshot's.
  assert.equal(c.count("a.updatedAt >= ? AND a.updatedAt < ?"), 1);
});
