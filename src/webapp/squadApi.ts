// Squads in the Mini App: the squad(s) the AUTHENTICATED user belongs to -- group-chat squads
// (/squad in a Telegram group) and app squads made here -- plus create / join by invite code /
// leave (POST). A user can belong to zero, one, or more squads (v2_squad_members has no unique
// constraint on accountId alone -- see migrations/0070_v2_long_tail.sql -- because someone can
// run /squad in more than one Telegram group), so this returns a list, not a single squad.
//
// Reuses the exact same domain computation the bot's own /squadboard command and weekly recap
// (src/bot/squad.ts) use -- squadWeek/squadMedal from src/domain/squad.ts -- rather than
// recomputing the standings a different way. Membership is derived entirely from the
// authenticated user's own row (squadsForUser); no client-supplied squad id is ever trusted.
import { createAppSquad, deleteSquad, getSquad, isAppSquad, joinSquad, leaveSquad, squadByInviteCode, squadCompletedDates, squadMembers, squadsForUser } from "../adapters/d1/v2Gamification";
import { botDeepLink } from "../bot/links";
import { logInfo } from "../log";
import { readJsonBody } from "./validate";
import { localParts } from "../domain/localTime";
import { weekStartStr } from "../domain/records";
import { squadMedal, squadWeek } from "../domain/squad";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

export const MAX_SQUAD_MEMBERS = 12;
export const MAX_SQUADS_PER_USER = 5;

const displayName = (m: { userId: number; name: string | null; alias: string | null }): string =>
  (m.alias || m.name || `id ${m.userId}`).trim() || `id ${m.userId}`;

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

export async function handleSquadsApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (req.method === "POST") {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.body as Record<string, unknown>;
    if (b.action === "create") {
      const title = typeof b.title === "string" ? b.title.trim().slice(0, 40) : "";
      if (!title) return Response.json({ error: "bad request" }, { status: 400 });
      if ((await squadsForUser(env.DB, user._id)).length >= MAX_SQUADS_PER_USER) return Response.json({ ok: false, reason: "too_many" });
      const squad = await createAppSquad(env.DB, title, user._id);
      logInfo("squad_created", { source: "webapp" });
      return Response.json({ ok: true, id: squad.chatId });
    }
    if (b.action === "join") {
      const result = await joinByInviteCode(env.DB, user._id, typeof b.code === "string" ? b.code : "");
      if (result === "joined") logInfo("squad_joined", { source: "webapp" });
      return Response.json({ ok: result === "joined" || result === "already", reason: result });
    }
    if (b.action === "leave") {
      const id = Number(b.id);
      if (!Number.isFinite(id) || !(await leaveSquad(env.DB, id, user._id))) return Response.json({ error: "not found" }, { status: 404 });
      if (!(await squadMembers(env.DB, id)).length) await deleteSquad(env.DB, id); // last one out closes it
      return Response.json({ ok: true });
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (req.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });

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
      const app = isAppSquad(chatId);
      return {
        id: chatId,
        app,
        inviteLink: app && squad.inviteCode ? botDeepLink(env, `sq_${squad.inviteCode}`) || null : null,
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
