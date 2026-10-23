// Joining an app squad by invite code: the app's POST join and the bot's sq_ deep link.
import { joinSquad, squadByInviteCode, squadMembers, squadsForUser } from "../../adapters/d1/v2Gamification";

export const MAX_SQUAD_MEMBERS = 12;
export const MAX_SQUADS_PER_USER = 5;

/** Join an app squad by its invite code. Shared by the app (POST join) and the bot's sq_ deep link. */
export async function joinByInviteCode(db: D1Database, userId: number, code: string): Promise<"joined" | "already" | "not_found" | "full" | "too_many"> {
  const squad = await squadByInviteCode(db, code.trim().toLowerCase().slice(0, 16));
  if (!squad) return "not_found";
  const members = await squadMembers(db, squad.chatId);
  if (members.some((m) => m.userId === userId)) return "already";
  if (members.length >= MAX_SQUAD_MEMBERS) return "full";
  if ((await squadsForUser(db, userId)).length >= MAX_SQUADS_PER_USER) return "too_many";
  await joinSquad(db, squad.chatId, userId);
  return "joined";
}
