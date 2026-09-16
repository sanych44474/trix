// Squad detail for the Mini App: the group-chat squad(s) the AUTHENTICATED user belongs to,
// read-only. A user can belong to zero, one, or more squads (v2_squad_members has no unique
// constraint on accountId alone -- see migrations/0070_v2_long_tail.sql -- because someone can
// run /squad in more than one Telegram group), so this returns a list, not a single squad.
//
// Reuses the exact same domain computation the bot's own /squadboard command and weekly recap
// (src/bot/squad.ts) use -- squadWeek/squadMedal from src/domain/squad.ts -- rather than
// recomputing the standings a different way. Membership is derived entirely from the
// authenticated user's own row (squadsForUser); no client-supplied squad id is ever trusted.
import { getSquad, squadCompletedDates, squadMembers, squadsForUser } from "../adapters/d1/v2Gamification";
import { localParts } from "../domain/progression";
import { weekStartStr } from "../domain/records";
import { squadMedal, squadWeek } from "../domain/squad";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

const displayName = (m: { userId: number; name: string | null; alias: string | null }): string =>
  (m.alias || m.name || `id ${m.userId}`).trim() || `id ${m.userId}`;

export async function handleSquadsApi(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const today = localParts(user.profile.timezone).date;
  const weekStart = weekStartStr(today);
  // squadsForUser is scoped to user._id (the authenticated account) -- the chat ids it returns
  // are never taken from the request, so a caller cannot ask for someone else's squad.
  const chatIds = await squadsForUser(env.DB, user._id).catch(() => [] as number[]);

  const squads = await Promise.all(
    chatIds.map(async (chatId) => {
      const [squad, members] = await Promise.all([getSquad(env.DB, chatId), squadMembers(env.DB, chatId)]);
      if (!squad) return null;
      const dates = await squadCompletedDates(env.DB, chatId, weekStart).catch(() => []);
      const week = squadWeek(members.map((m) => ({ userId: m.userId, name: displayName(m) })), dates, weekStart);
      return {
        title: squad.title,
        memberCount: members.length,
        entries: week.entries.map((e, i) => ({
          name: e.name,
          workouts: e.workouts,
          me: e.userId === user._id,
          medal: squadMedal(week.entries, i),
        })),
        total: week.total,
        silent: week.silent,
      };
    }),
  );

  return Response.json(
    { squads: squads.filter((s): s is NonNullable<typeof s> => s !== null) },
    { headers: { "cache-control": "no-store" } },
  );
}
