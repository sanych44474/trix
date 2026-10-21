// The owner's inactive-user cleanup core: candidate selection, the eligibility re-check and the
// per-user purge. Shared by the bot's Clean up screen (bot/cleanup.ts) and the Mini App's bulk
// cleanup route, so both delete exactly the same people.
import type { Env, UserDoc } from "../../types";
import type { DB } from "../../adapters/d1/shared";
import { deleteUserData } from "../../adapters/d1/v2Account";
import { recordAudit } from "../../adapters/d1/v2Admin";
import { listClients, unlinkClient } from "../../adapters/d1/v2Trainer";
import { listInactive } from "../../adapters/d1/v2Users";

export const INACTIVE_DAYS = 7;

// Re-verify a candidate is still deletable at the moment of the owner's tap (defense in depth).
// Only the owner is excluded; trainers, clients and on-vacation users are all deletable.
export function cleanupEligible(u: UserDoc | null, ownerId: number): boolean {
  if (!u) return false;
  if (u._id === ownerId) return false; // owner is the only exception
  if (u.inactiveReply === "leaving") return true; // explicitly asked to be removed
  const cutoff = Date.now() - INACTIVE_DAYS * 86_400_000;
  return (u.lastSeenAt ?? u.createdAt).getTime() < cutoff;
}

// Delete a user and, if they were a trainer, unlink their clients back to solo so none are orphaned.
export async function purgeUser(env: Env, db: DB, u: UserDoc) {
  if (u.role === "trainer") {
    for (const c of await listClients(db, u._id)) await unlinkClient(db, c._id).catch(() => {});
  }
  await deleteUserData(env, u._id);
}

// The owner's cleanup candidates: inactive users (not the owner), shared by the bot's
// "Clean up" and the app's bulk cleanup.
export async function listCleanupCandidates(db: DB, ownerId: number): Promise<UserDoc[]> {
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86_400_000).toISOString();
  return (await listInactive(db, cutoff, nowIso)).filter((u) => u._id !== ownerId);
}

// Delete every eligible candidate (re-checked at delete time), auditing each. Returns the count.
export async function purgeCleanupCandidates(env: Env, db: DB, ownerId: number, candidates: UserDoc[]): Promise<number> {
  let n = 0;
  for (const u of candidates) {
    if (!cleanupEligible(u, ownerId)) continue;
    await purgeUser(env, db, u);
    await recordAudit(db, ownerId, "delete_user", u._id, u.profile.name ?? undefined);
    n++;
  }
  return n;
}
