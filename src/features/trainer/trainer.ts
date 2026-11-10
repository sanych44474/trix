// Trainer pairing and the shared trainer use cases: the /start tr_ and trp_ deep links (ADR-0012
// keeps them), the owner's approve/reject of an application, accepting a client request, the
// waitlist nudge and the trainer report data the app reads.

import { InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import type { Lang, UserDoc } from "../../types";
import { eventCountsByUser } from "../../adapters/d1/v2Analytics";
import { getOwnerChatId } from "../../adapters/d1/v2Admin";
import { countCompletedWorkouts } from "../../adapters/d1/v2Workouts";
import { planStatusByUser } from "../../adapters/d1/v2Plans";
import { approveTrainer, countClientsOf, getTrainer, getTrainerByCode, linkClient, listClients, pendingRequestsForTrainer, rejectTrainer, deleteProspect, getProspect } from "../../adapters/d1/v2Trainer";
import { getUser, updateUser } from "../../adapters/d1/v2Users";
import { isoDateMinus } from "../gamification/boards";
import { botDeepLink } from "../../notify/links";
import { interviewProgress } from "../owner/ownerRows";
import { localParts } from "../../domain/localTime";
import { t } from "../../locales/i18n";
import { type MyContext, HTML, reply } from "../../adapters/telegram/context";
import { notifySafely } from "../../notify";
import { sendOnboardingPrompt } from "../../notify/onboardingApp";
import { shortCode, trainerMenu } from "./trainerCommon";

// Auto-pair via the trainer's own invite link.
// Tell the trainer a client just paired with them, with a one-tap link to the client card.
// When the client already has training history, surface it (the card has full analytics).
export async function notifyTrainerOfClient(ctx: MyContext, trainer: UserDoc, client: UserDoc, withHistory: boolean) {
  const who = client.profile.name ?? `id ${client._id}`;
  const kb = new InlineKeyboard().text(t(trainer.lang, "cc_open_card"), `cl:${client._id}:card`);
  let body: string;
  if (withHistory) {
    const workouts = await countCompletedWorkouts(ctx.db, client._id).catch(() => 0);
    body = t(trainer.lang, "trainer_client_joined_history", { name: who, workouts });
  } else {
    body = t(trainer.lang, "trainer_client_joined", { name: who });
  }
  await notifySafely(ctx.env, { api: ctx.api }, { userId: trainer._id, chatId: trainer.chatId }, {
    kind: "trainer_client_joined",
    // Per day: a retried join is one message, but re-pairing after an unlink is news again.
    key: `client_joined:${trainer._id}:${client._id}:${new Date().toISOString().slice(0, 10)}`,
    text: body,
    extra: { ...HTML, reply_markup: kb },
  });
}

// One-time consent prompt sent to the CLIENT right after linking to a trainer: opt in to
// sharing body data / health details on the client card (both stay hidden until enabled).
export function sharePromptKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "share_body_btn"), "share:tog:body")
    .row()
    .text(t(lang, "share_health_btn"), "share:tog:health")
    .row()
    .text(t(lang, "share_skip_btn"), "share:skip");
}

// Shared by joinByCode (generic tr_<code> link) and joinByProspectCode (personal trp_<code>
// link) — everything after the trainer has been resolved is identical either way.
async function pairWithTrainer(ctx: MyContext, trainerId: number, trainerName: string) {
  const lang = ctx.user.lang;
  await linkClient(ctx.db, ctx.user._id, trainerId);
  logInfo("trainer_client_connected", {});
  ctx.user.role = "client";
  ctx.user.trainerId = trainerId;
  const trainer = await getUser(ctx.db, trainerId);
  // Already-onboarded athlete → transfer WITHOUT re-onboarding. linkClient keeps all their data
  // (logs, body, records, plan); the trainer sees it all on the client card for analytics.
  if (ctx.user.onboarded) {
    ctx.user.session = { mode: "idle" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "client_transferred", { name: trainerName }));
    if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, true);
    await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
    return;
  }
  // Brand-new user → the questionnaire first (we are in the client's context). One message, one
  // button: the Mini App asks the questions one at a time, including what the trainer may see.
  await reply(ctx, t(lang, "client_paired", { name: trainerName }));
  if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, false);
  ctx.user.session = { mode: "onboarding", step: 0 };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  // ADR-0012: the questionnaire is the app's. Without an app URL (a dev bot) there is no chat
  // wizard to fall back to any more; the sharing ask still goes out.
  if (await sendOnboardingPrompt(ctx)) return;
  await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
}

export async function joinByCode(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "trainer") {
    await reply(ctx, t(lang, "trainer_join_own_link"));
    return;
  }
  const tr = await getTrainerByCode(ctx.db, code.trim());
  if (!tr) {
    await reply(ctx, t(lang, "code_invalid"));
    return;
  }
  await pairWithTrainer(ctx, tr.trainerId, tr.name);
}

// Owner approval of a trainer application (the owner's trainer:approve / trainer:reject buttons).
export async function onTrainerApprove(ctx: MyContext, trainerId: number) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId !== ctx.user.chatId) return;
  const code = shortCode();
  await approveTrainer(ctx.db, trainerId, code);
  await reply(ctx, t(ctx.user.lang, "trainer_approved_owner"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) {
    const link = botDeepLink(ctx.env, `tr_${code}`);
    await notifySafely(ctx.env, { api: ctx.api }, { userId: trainerId, chatId: trainer.chatId }, {
      kind: "trainer_approved",
      key: `trainer_approved:${trainerId}:${code}`,
      text: t(trainer.lang, "trainer_approved", { link }),
      extra: { ...HTML, reply_markup: trainerMenu(trainer.lang) },
    });
  }
}

export async function onTrainerReject(ctx: MyContext, trainerId: number) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId !== ctx.user.chatId) return;
  const application = await getTrainer(ctx.db, trainerId);
  await rejectTrainer(ctx.db, trainerId);
  await reply(ctx, t(ctx.user.lang, "trainer_rejected_owner"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) {
    await notifySafely(ctx.env, { api: ctx.api }, { userId: trainerId, chatId: trainer.chatId }, {
      kind: "trainer_rejected",
      key: `trainer_rejected:${trainerId}:${application?.createdAt.getTime() ?? 0}`,
      text: t(trainer.lang, "trainer_rejected"),
      extra: HTML,
    });
  }
}

// /start trp_<code> — the personal-invite counterpart to joinByCode's tr_<code>. Same pairing
// (and the same already-onboarded-vs-fresh branches), plus: the trainer's own name for this
// person wins over whatever Telegram happens to show, and the prospect record is consumed.
export async function joinByProspectCode(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "trainer") { await reply(ctx, t(lang, "trainer_join_own_link")); return; }
  const prospect = await getProspect(ctx.db, code.trim());
  if (!prospect) { await reply(ctx, t(lang, "code_invalid")); return; }
  const tr = await getTrainer(ctx.db, prospect.trainerId);
  if (!tr) { await reply(ctx, t(lang, "code_invalid")); return; }
  // Single-use claim, done BEFORE any pairing side effect: DELETE is one atomic statement, so
  // under a race (a duplicate Telegram webhook delivery, or two people opening the same link)
  // only one caller's delete actually removes the row — the other sees `claimed=false` and
  // bails here instead of pairing off a prospect record that just got consumed elsewhere.
  const claimed = await deleteProspect(ctx.db, prospect.code);
  if (!claimed) { await reply(ctx, t(lang, "code_invalid")); return; }
  ctx.user.profile = { ...ctx.user.profile, name: prospect.name };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
  await pairWithTrainer(ctx, prospect.trainerId, tr.name);
}

interface WaitlistNudge {
  userId: number;
  chatId: number;
  lang: Lang;
  text: string;
  /** One nudge per freed-up roster size: the same slot state is not announced twice. */
  key: string;
}

/** When a trainer's roster spot frees (client left / limit raised): the nudge toward their
 * waitlist if they're now under capacity and have pending requests, or null if there's nothing
 * to send. Ctx-free and DB-only so both the chat leave-trainer flow and the Mini App's leave-
 * trainer action can trigger the identical notification instead of one of them silently
 * skipping it. */
export async function resolveWaitlistNudge(db: D1Database, trainerId: number): Promise<WaitlistNudge | null> {
  const [tr, trainerUser, n, pending] = await Promise.all([
    getTrainer(db, trainerId),
    getUser(db, trainerId),
    countClientsOf(db, trainerId),
    pendingRequestsForTrainer(db, trainerId),
  ]);
  if (!tr || !trainerUser || !pending.length) return null;
  if (tr.maxClients !== undefined && n >= tr.maxClients) return null; // still full
  return {
    userId: trainerId,
    chatId: trainerUser.chatId,
    lang: trainerUser.lang,
    text: t(trainerUser.lang, "waitlist_slot_free", { n: pending.length }),
    key: `waitlist_slot:${trainerId}:${n}`,
  };
}

// On-demand trainer report — the owner's /users table scoped to this trainer's clients
// (same columns minus trainer/ban), plus one-tap "finish the interview" nudges below.
interface TrainerReportRow {
  u: UserDoc;
  ev: { workouts: number; checkins: number; nutrition: number; steps: number };
  ps?: { active: boolean; draft: boolean };
  prog: { filled: number; total: number };
}

export interface TrainerReport {
  /** Clients in listClients order (the bot's "finish the interview" buttons follow it). */
  clients: UserDoc[];
  /** Most-active first, the same ranking as the owner table. */
  ranked: TrainerReportRow[];
  active7: number;
  activePct: number;
}

// The weekly report data, shared by the bot's /trreport text table and the app's Report tab.
// Retention snapshot: active in the last 7 days / total clients, in the trainer's timezone.
export async function trainerReportData(db: D1Database, trainer: UserDoc): Promise<TrainerReport> {
  const clients = await listClients(db, trainer._id);
  const [eventCounts, planStatus] = await Promise.all([
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
  ]);
  const todayStr = localParts(trainer.profile.timezone).date;
  const active7 = clients.filter((c) => c.lastSeenAt && c.lastSeenAt.toISOString().slice(0, 10) >= isoDateMinus(todayStr, 7)).length;
  const activePct = clients.length ? Math.round((active7 / clients.length) * 100) : 0;
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  const ranked: TrainerReportRow[] = [...clients]
    .map((u) => ({ u, ev: eventCounts.get(u._id) ?? zero, ps: planStatus.get(u._id), prog: interviewProgress(u.profile) }))
    .sort((a, b) => {
      const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
      return sum(b.ev) - sum(a.ev);
    });
  return { clients, ranked, active7, activePct };
}
