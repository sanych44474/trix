// Trainer <-> client communication: reviewing and correcting a client's logged workouts, direct
// messages and replies, and answering client questions. Split out of trainer.ts; trainer.ts
// re-exports everything here.
import { InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import { notify, type DeliveryResult } from "../../notify";
import type { SetEntry } from "../../types";
import { recordAudit } from "../../adapters/d1/v2Admin";
import { getWorkoutLog, listStrength, upsertStrengthRecord, upsertWorkoutLog, workoutLogsSince } from "../../adapters/d1/v2Workouts";
import { getActivePlan } from "../../adapters/d1/v2Plans";
import { getClientForTrainer, getQuestion, insertMessage, setQuestionStatus } from "../../adapters/d1/v2Trainer";
import { getUser, updateUser } from "../../adapters/d1/v2Users";
import { bestSetForMetric, formatSetEntry, metricOfSets } from "../../domain/setFormat";
import { getPlanDay } from "../../domain/progression";
import { normalizeExercise, parseWorkoutText } from "../../domain/workoutText";
import { escapeHtml, t } from "../../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../../adapters/telegram/context";
import { localCutoff } from "../../bot/report";
import { menuBtn } from "../../bot/keyboards";
import { weekdayOf } from "../../bot/calendar";
import { clientCardKb } from "./trainerCommon";

export async function showClientLogDays(ctx: MyContext, clientId: number) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const logs = await workoutLogsSince(ctx.db, clientId, localCutoff(client.profile.timezone, 60));
  const recent = [...logs].reverse().slice(0, 10);
  if (!recent.length) { await reply(ctx, t(lang, "clog_none"), clientCardKb(lang, clientId)); return; }
  const kb = new InlineKeyboard();
  for (const w of recent) {
    const n = w.exercises.filter((e) => !e.skipped).length;
    kb.text(`${w.completed ? "✅" : "✖️"} ${w.date} · ${t(lang, "clog_n_ex", { n })}`.slice(0, 60), `clog:${clientId}:${w.date}`).row();
  }
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, t(lang, "clog_pick"), kb);
}

export async function showClientLogDay(ctx: MyContext, clientId: number, date: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const log = await getWorkoutLog(ctx.db, clientId, date);
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  const done = (log?.exercises ?? []).filter((e) => !e.skipped);
  let body = t(lang, "clog_day_title", { name: cname, date });
  body += done.length
    ? "\n" + done.map((e) => `• ${escapeHtml(e.name)}: ${e.setsDone.map(formatSetEntry).join(", ") || "—"}`).join("\n")
    : "\n" + t(lang, "clog_day_empty");
  // Show what the plan had for that weekday, so the trainer sees what's missing.
  const plan = await getActivePlan(ctx.db, clientId);
  const planDay = plan ? getPlanDay(plan, weekdayOf(date)) : undefined;
  if (planDay) body += "\n\n" + t(lang, "clog_planned", { n: planDay.exercises.length, list: planDay.exercises.map((e) => e.name).join(", ") });
  const kb = new InlineKeyboard()
    .text(t(lang, "clog_rewrite_btn"), `clogedit:${clientId}:${date}`)
    .row()
    .text(t(lang, "back"), `cl:${clientId}:logs`);
  await reply(ctx, body, kb);
}

export async function startClientLogEdit(ctx: MyContext, clientId: number, date: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  ctx.user.session = { mode: "edit_client_log", targetId: clientId, awaitText: date };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "clog_rewrite_prompt", { date }));
}

export async function handleClientLogEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const date = ctx.user.session.awaitText;
  if (!clientId || !date) { await setMode(ctx, "idle"); return; }
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await setMode(ctx, "idle"); await reply(ctx, t(lang, "client_not_found")); return; }
  const sets = parseWorkoutText(text);
  if (!sets.length) { await reply(ctx, t(lang, "log_unreadable")); return; } // stay in mode, re-prompt
  await setMode(ctx, "idle");
  const wd = weekdayOf(date);
  const plan = await getActivePlan(ctx.db, clientId);
  const existing = await listStrength(ctx.db, clientId);
  const candidates = [
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.name)) ?? []),
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.canonicalName).filter((n): n is string => !!n)) ?? []),
    ...existing.map((r) => r.exercise),
  ];
  const byExercise = new Map<string, SetEntry[]>();
  const rpeByExercise = new Map<string, number>();
  for (const s of sets) {
    const name = normalizeExercise(s.exercise, candidates);
    const arr = byExercise.get(name) ?? [];
    arr.push({
      reps: s.reps, weight: s.weight,
      ...(typeof s.seconds === "number" ? { seconds: s.seconds } : {}),
      ...(typeof s.meters === "number" ? { meters: s.meters } : {}),
      ...(typeof s.rpe === "number" ? { rpe: s.rpe } : {}),
    });
    byExercise.set(name, arr);
    if (typeof s.rpe === "number") rpeByExercise.set(name, Math.max(rpeByExercise.get(name) ?? 0, s.rpe));
  }
  const exercises = [...byExercise.entries()].map(([name, setsDone]) => ({ name, setsDone, skipped: false, ...(rpeByExercise.has(name) ? { rpe: rpeByExercise.get(name)! } : {}) }));
  await upsertWorkoutLog(ctx.db, clientId, date, wd, exercises, true, text);
  // Keep the client's strength records in sync with the corrected log.
  for (const [name, setsDone] of byExercise) {
    const metric = metricOfSets(setsDone);
    const best = bestSetForMetric(setsDone, metric);
    if (best) await upsertStrengthRecord(ctx.db, clientId, name, { metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters }, date, rpeByExercise.get(name)).catch(() => {});
  }
  await recordAudit(ctx.db, ctx.user._id, "edit_client_log", clientId, date).catch(() => {});
  await reply(ctx, t(lang, "clog_saved", { n: exercises.length }));
  await showClientLogDay(ctx, clientId, date);
}

// Maps an outbox delivery outcome to the SENDER's own feedback line, and marks the recipient's
// botBlocked flag on a permanent block. Shared by handleTrainerMessage/handleClientReply so both
// directions of the trainer<->client thread report delivery the same way — used to be a direct
// ctx.api.sendMessage with the result swallowed (.catch(() => {})) and "✅ Sent." shown
// unconditionally regardless of whether Telegram actually delivered anything.
export async function messageDeliveryFeedback(ctx: MyContext, result: DeliveryResult, recipientId: number, recipientName: string): Promise<string> {
  const lang = ctx.user.lang;
  if (result === "blocked") {
    await updateUser(ctx.db, recipientId, { botBlocked: true }).catch(() => {});
    return t(lang, "msg_blocked", { name: recipientName });
  }
  if (result === "retrying") return t(lang, "msg_queued", { name: recipientName });
  if (result === "failed") return t(lang, "msg_failed");
  return t(lang, "msg_sent"); // "sent" or "duplicate" (already delivered under this key)
}

export async function handleTrainerMessage(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  await insertMessage(ctx.db, ctx.user._id, clientId, text);
  // Give the client a one-tap reply back to this trainer (threaded messaging).
  const replyKb = new InlineKeyboard().text(t(client.lang, "msg_reply_btn"), `msg:reply:${ctx.user._id}`);
  // Through the outbox: a failed send now retries instead of vanishing, and the trainer is told
  // what actually happened instead of an unconditional "Sent."
  const result: DeliveryResult = await notify(ctx.env, { api: ctx.api }, { userId: clientId, chatId: client.chatId }, {
    kind: "trainer_msg",
    key: `trainer_msg:${ctx.user._id}:${Date.now()}`,
    text: t(client.lang, "msg_from_trainer", { text: escapeHtml(text) }),
    extra: { ...HTML, reply_markup: replyKb },
  }).catch((e) => { console.error("trainer msg enqueue", e); return "failed" as const; });
  await reply(ctx, await messageDeliveryFeedback(ctx, result, clientId, client.profile.name ?? `id ${clientId}`), menuBtn(lang));
}

// Client tapped "Reply" on a trainer message → deliver it back to the trainer with a reply
// button of their own, closing the async messaging loop with notifications both ways.
export async function handleClientReply(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const trainerId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!trainerId) return;
  // The "↩ Reply" button is left in chat history indefinitely — re-verify the pairing is still
  // current before delivering, so a message can't reach a trainer the client has since left.
  if (ctx.user.trainerId !== trainerId) { await reply(ctx, t(lang, "client_not_found")); return; }
  const trainer = await getUser(ctx.db, trainerId);
  if (!trainer) { await reply(ctx, t(lang, "error_generic")); return; }
  await insertMessage(ctx.db, ctx.user._id, trainerId, text);
  const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
  const kb = new InlineKeyboard().text(t(trainer.lang, "msg_reply_btn"), `cl:${ctx.user._id}:msg`);
  const result: DeliveryResult = await notify(ctx.env, { api: ctx.api }, { userId: trainerId, chatId: trainer.chatId }, {
    kind: "client_reply",
    key: `client_reply:${ctx.user._id}:${Date.now()}`,
    text: t(trainer.lang, "msg_from_client", { name: who, text: escapeHtml(text) }),
    extra: { ...HTML, reply_markup: kb },
  }).catch((e) => { console.error("client reply enqueue", e); return "failed" as const; });
  await reply(ctx, await messageDeliveryFeedback(ctx, result, trainerId, trainer.profile.name ?? `id ${trainerId}`), menuBtn(lang));
}

// --- client question: trainer's reply actions ---

export async function onQuestionSend(ctx: MyContext, qid: number) {
  const lang = ctx.user.lang;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id || q.status !== "pending") { await reply(ctx, t(lang, "request_gone")); return; }
  if (!q.aiDraft) { await reply(ctx, t(lang, "q_no_draft")); return; }
  await deliverTrainerAnswer(ctx, q.clientId, q.aiDraft);
  await setQuestionStatus(ctx.db, qid, "answered");
  await reply(ctx, t(lang, "q_done"));
}

export async function onQuestionOwn(ctx: MyContext, qid: number) {
  const lang = ctx.user.lang;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id || q.status !== "pending") { await reply(ctx, t(lang, "request_gone")); return; }
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "answer_q", targetId: qid } });
  await reply(ctx, t(lang, "q_write_prompt"));
}

export async function onQuestionSkip(ctx: MyContext, qid: number) {
  const lang = ctx.user.lang;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id || q.status !== "pending") { await reply(ctx, t(lang, "request_gone")); return; }
  await setQuestionStatus(ctx.db, qid, "dismissed");
  await reply(ctx, t(lang, "q_dismissed"));
}

export async function handleAnswerQuestion(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const qid = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!qid) return;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id) { await reply(ctx, t(lang, "request_gone")); return; }
  await deliverTrainerAnswer(ctx, q.clientId, text);
  await setQuestionStatus(ctx.db, qid, "answered");
  await reply(ctx, t(lang, "q_done"), menuBtn(lang));
}

export async function deliverTrainerAnswer(ctx: MyContext, clientId: number, text: string) {
  const client = await getUser(ctx.db, clientId);
  if (!client) return;
  await insertMessage(ctx.db, ctx.user._id, clientId, text);
  await ctx.api.sendMessage(client.chatId, t(client.lang, "answer_from_trainer", { text: escapeHtml(text) }), HTML).catch(() => {});
  logInfo("trainer_question_answered", {}); // only caller of this function is the question-answer flow (both its callers)
}
