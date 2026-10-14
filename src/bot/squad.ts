// Squad mode — the bot in a group chat friends already use.
//
// Two things make this different from the global leaderboard the app already has. First, it lives
// where the conversation already happens instead of asking people to open another screen. Second,
// its own feature-audit says public boards demotivate at the current user count: a squad is a
// handful of people who know each other, where "nobody has trained yet this week" is a nudge
// rather than a ranking.
//
// SAFETY: group chats are handled entirely here and NEVER fall through to the private-chat
// router. Every other handler assumes a 1:1 chat — letting a group update reach them would dump
// someone's plan into the group, and would create their user row with the GROUP's chat id as
// their personal chatId, sending every future reminder to the group.
import { HTML, type MyContext } from "../adapters/telegram/context";
import { getUser } from "../adapters/d1/v2Users";
import { deleteSquad, getSquad, joinSquad, leaveSquad, squadMembers, upsertSquad } from "../adapters/d1/v2Gamification";
import { weekStartStr } from "../domain/records";
import { wakeSquadScheduler } from "../durable/squadScheduler";
import { t } from "../locales/i18n";
import type { Lang } from "../types";
import { postSquadDigest } from "../features/squad/digest";


const GROUP_COMMAND = /^\/(squad|squadleave|squadboard)(?:@[\w_]+)?(?:\s|$)/i;

/**
 * Everything the bot does inside a group chat. Returns without a word for anything that isn't a
 * squad command — a group is not the place for the bot to have opinions unprompted.
 */
export async function handleGroupUpdate(ctx: MyContext, today: string): Promise<void> {
  const text = ctx.message?.text ?? "";
  const match = GROUP_COMMAND.exec(text);
  if (!match || !ctx.from || !ctx.chat) return;
  const command = match[1].toLowerCase();
  const chatId = ctx.chat.id;
  const title = "title" in ctx.chat ? (ctx.chat.title ?? null) : null;

  // Squad membership is for people who already use the bot: it reads their training log. Anyone
  // else gets pointed at a DM rather than silently added.
  const user = await getUser(ctx.db, ctx.from.id).catch(() => null);
  const lang: Lang = user?.lang ?? (ctx.from.language_code?.startsWith("uk") ? "uk" : "en");
  const say = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    ctx.reply(t(lang, key, vars), HTML).catch(() => {});

  // An owner-banned account is ignored entirely in private chats; a group must not be a way
  // around that. Silent, deliberately — a ban should not announce itself to the group.
  if (user?.blocked) return;
  if (!user || !user.onboarded) {
    await say("squad_dm_first");
    return;
  }

  if (command === "squad") {
    await upsertSquad(ctx.db, chatId, title, user._id);
    const added = await joinSquad(ctx.db, chatId, user._id);
    const members = await squadMembers(ctx.db, chatId);
    // Arms the squad's recap DO (dry-run phase — see squadScheduler.ts). Best-effort: a wake
    // failure must never block the join confirmation the person is waiting on.
    await wakeSquadScheduler(ctx.env, chatId).catch(() => {});
    await say(added ? "squad_joined" : "squad_already_in", { name: user.alias || user.profile.name || "", n: members.length });
    return;
  }

  if (command === "squadleave") {
    const removed = await leaveSquad(ctx.db, chatId, user._id);
    const members = await squadMembers(ctx.db, chatId);
    if (!members.length) await deleteSquad(ctx.db, chatId); // last one out closes the squad
    await say(removed ? "squad_left" : "squad_not_in");
    return;
  }

  // squadboard
  const squad = await getSquad(ctx.db, chatId);
  if (!squad) {
    await say("squad_not_here");
    return;
  }
  await postSquadDigest(ctx.db, ctx.api, chatId, { weekStart: weekStartStr(today) });
}
