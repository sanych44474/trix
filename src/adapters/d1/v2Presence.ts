// Records that an account was just here, from either surface. The decision is pure
// (domain/presence.ts); this is the write and the `session_started` event around it.
import { logInfo } from "../../log";
import { presenceStep } from "../../domain/presence";
import { markSeen } from "./v2Analytics";
import type { DB } from "./shared";

/** Never throws: presence is bookkeeping and must not fail the request that triggered it. Updates
 * `user.lastSeenAt` in place so a second call in the same request does not write again. Resolves to
 * whether a write happened. */
export async function recordPresence(
  db: DB,
  user: { _id: number; lastSeenAt?: Date },
  surface: "bot" | "miniapp",
  nowMs = Date.now(),
): Promise<boolean> {
  const step = presenceStep(user.lastSeenAt, nowMs);
  if (step.newSession) logInfo("session_started", { surface });
  if (!step.write) return false;
  const when = new Date(nowMs);
  user.lastSeenAt = when;
  try {
    await markSeen(db, user._id, when.toISOString(), step.newSession ? when.toISOString().slice(0, 10) : null);
    return true;
  } catch {
    return false;
  }
}
