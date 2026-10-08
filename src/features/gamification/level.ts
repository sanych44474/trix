// Level bookkeeping after an XP-earning action. Before this, the chat path (aiDefer.ts
// maybeCelebrateLevel) and the Mini App save (webapp/workout.ts) each read the XP counts, decided
// the transition, persisted `lastLevel` and awarded the milestone badge with their own copy of the
// same six steps. The decision itself was already shared (domain/gamification.ts levelTransition);
// the storage around it was not.
//
// The first sighting of a level is persisted silently so existing users are not congratulated
// retroactively for levels they passed before the feature shipped.
import type { UserDoc } from "../../types";
import { userStatCounts } from "../../adapters/d1/v2Analytics";
import { awardAchievement } from "../../adapters/d1/v2Gamification";
import { updateUser } from "../../adapters/d1/v2Users";
import { computeXp, levelFromXp, levelTransition } from "../../domain/gamification";

export interface LevelUpdate {
  level: number;
  xp: number;
  /** The user crossed into a higher level than the one last recorded. */
  leveledUp: boolean;
  /** A milestone badge code (level_5 / level_10) that was newly awarded by this call, if any. */
  freshBadge: string | null;
}

/** Reads XP, records the new level on `user` (in place, like applyWorkoutSave does for prCount) and
 * awards the level badge. Best-effort: a failure here must never fail the action that earned the
 * XP, so it resolves to null instead of throwing. */
export async function advanceLevel(db: D1Database, user: UserDoc): Promise<LevelUpdate | null> {
  try {
    const lv = levelFromXp(computeXp(await userStatCounts(db, user._id)));
    const transition = levelTransition(lv.level, user.reminders?.lastLevel);
    let freshBadge: string | null = null;
    if (transition.changed) {
      const reminders = { ...user.reminders, lastLevel: transition.level };
      await updateUser(db, user._id, { reminders });
      user.reminders = reminders;
      if (transition.badge && (await awardAchievement(db, user._id, transition.badge).catch(() => false))) freshBadge = transition.badge;
    }
    return { level: lv.level, xp: lv.xp, leveledUp: transition.leveledUp, freshBadge };
  } catch {
    return null;
  }
}
