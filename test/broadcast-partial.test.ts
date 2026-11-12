// A broadcast refused part-way must say how many were already queued: those messages are on
// their way, and tapping "send" again would deliver an announcement to them twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { queueAnnouncement, type BroadcastMessage } from "../src/features/owner/broadcastQueue";
import type { Env } from "../src/types";

test("a refused second batch reports how many went out and records it", async () => {
  const db = newDb();
  for (let id = 1; id <= 150; id++) {
    await getOrCreateUser(db, id, id * 10, "uk", `U${id}`);
    await updateUser(db, id, { onboarded: true });
  }
  const env = { DB: db } as unknown as Env;
  let calls = 0;
  const queue = { sendBatch: async () => { if (++calls === 2) throw new Error("queue unavailable"); } } as unknown as Queue<BroadcastMessage>;
  await assert.rejects(queueAnnouncement(env, queue, 1, "hi"), /stopped after 100 of 150/);
  const row = await db.prepare("SELECT payload FROM v2_audit_events WHERE kind = 'broadcast_partial'").first<{ payload: string }>();
  assert.match(row?.payload ?? "", /queued 100 of 150/);
});
