// Minimal single-turn "Ask the AI coach" endpoint for solo/trainer self-coaching. The bot already
// has a general free-text AI chat entrypoint (handleCoach / src/bot/coach.ts, reachable by just
// typing a message, or the voice note "Ask coach" option) -- this exposes the same underlying AI
// orchestration (aiText, src/ai/index.ts: provider-fallback chain, per-user rate limiting, call
// logging) to the Mini App as a plain question-in/answer-out call. It intentionally does NOT reuse
// handleCoach/coachContext directly: those take a grammY `ctx: MyContext` and return tap-to-apply
// plan-edit actions (JSON schema, deferred past the webhook) -- much more than a single-turn
// ask-and-answer needs. This route builds its own light, D1-only context (active plan + last 14
// days), matching the same self-contained pattern nutritionApi.ts's "recipe"/"recover" AI actions
// already use (a feature-specific system prompt handed to aiText, not a shared ctx-bound builder).
//
// A client with a human trainer gets the human-in-the-loop flow instead of a direct AI answer:
// the question is stored, the AI drafts a reply in the trainer's voice, and the trainer is asked
// to send it / write their own / skip -- the same routing src/bot/coach.ts's routeClientQuestion
// does, so a question asked in the Mini App lands in the trainer's existing q:send/q:own/q:skip
// keyboard and in their questions panel. This used to 403 the client outright, which left the
// client role mute in the Mini App: no AI coach, and no way to reach their trainer either.
import { appMarkup } from "../notify/appKeyboard";
import { aiJSON, aiText } from "../ai/index";
import { knowledgeBlock, searchKnowledge } from "../knowledge/search";
import * as P from "../ai/prompts";
import { coachContext } from "../bot/coach";
import { storeFeedback } from "../bot/feedbackIntake";
import { miniAppCoachActions, validateCoachEditResult } from "../domain/coachActions";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getRecentContext } from "../adapters/d1/v2Analytics";
import { getUser } from "../adapters/d1/v2Users";
import { createQuestion, getTrainer, listMessages, listQuestionsForClient, setQuestionDraft } from "../adapters/d1/v2Trainer";
import { localParts } from "../domain/localTime";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { weekdayName } from "../render";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import type { Env } from "../types";

const MAX_QUESTION = 500;

async function tgSend(env: Env, chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch(() => {});
}

export async function handleCoachApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // The client's own view of the Q&A: what they asked, plus the trainer's replies (the answer
  // route writes each one into v2_messages, which was otherwise only readable by the trainer).
  if (url.pathname === "/api/coach/thread") {
    if (req.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (!user.trainerId) return Response.json({ trainer: null, questions: [], messages: [] }, { headers: { "cache-control": "no-store" } });
    const [trainerUser, questions, messages] = await Promise.all([
      getUser(env.DB, user.trainerId).catch(() => null),
      listQuestionsForClient(env.DB, user._id, 20).catch(() => []),
      listMessages(env.DB, user.trainerId, user._id, 50).catch(() => []),
    ]);
    return Response.json({
      trainer: trainerUser ? { name: trainerUser.profile.name ?? "" } : null,
      questions: questions.map((q) => ({ id: q.id, text: q.text, status: q.status, createdAt: q.createdAt.toISOString() })),
      messages: messages.map((m) => ({ fromMe: m.fromId === user._id, text: m.text, createdAt: m.createdAt })),
    }, { headers: { "cache-control": "no-store" } });
  }

  // The coach's "send to the team" button: the AI summary plus the user's own message, to the
  // feedback table and the owner (same store as /feedback and the bot coach's button).
  if (url.pathname === "/api/coach/feedback") {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.body as Record<string, unknown>;
    const summary = typeof b.summary === "string" ? b.summary.trim().slice(0, 600) : "";
    const original = typeof b.original === "string" ? b.original.trim().slice(0, 1000) : "";
    if (summary.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
    const res = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      await storeFeedback(env.DB, (chatId, html) => tgSend(env, chatId, html), { userId: user._id, username: user.username, timezone: user.profile.timezone }, summary, { original });
      return { status: 200, body: { ok: true } };
    });
    return Response.json(res.body, { status: res.status });
  }

  if (url.pathname !== "/api/coach/ask") return Response.json({ error: "not found" }, { status: 404 });
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION) return Response.json({ error: "bad request" }, { status: 400 });

  const [plan, recent] = await Promise.all([
    getActivePlan(env.DB, user._id).catch(() => null),
    getRecentContext(env.DB, user._id, 14).catch(() => ({ workouts: [], nutrition: [] })),
  ]);
  const { date } = localParts(user.profile.timezone);
  const planText = plan?.split.length
    ? plan.split.map((d) => `${weekdayName("en", d.weekday)}: ${d.exercises.map((e) => e.name).join(", ")}`).join(" | ")
    : "no active plan";
  const workoutsDone = recent.workouts.filter((w) => w.completed).length;
  const nutritionDays = recent.nutrition.length;
  const langName = user.lang === "uk" ? "Ukrainian" : "English";
  const system =
    `You are a supportive, practical fitness & nutrition coach inside a Telegram fitness app. ` +
    `Ground your answer in the athlete's real plan and recent activity below when it's relevant to the question. ` +
    `Never give a medical diagnosis -- for pain, injury, or medical concerns, suggest seeing a professional. ` +
    `Answer in ${langName}. Plain text only -- no markdown, no LaTeX, no backslashes, max 10 short lines.\n\n` +
    `Current plan: ${planText}\n` +
    `Last 14 days: ${workoutsDone} workout(s) completed, ${nutritionDays} day(s) of nutrition logged.\n` +
    `Today: ${date}.`;

  // Client with a human trainer: their coach is a person, so the question is routed instead of
  // answered. Persist FIRST -- the client's "sent" must never outrun the write (same ordering the
  // bot's routeClientQuestion uses); the AI draft and the trainer push are both best-effort.
  if (user.role === "client" && user.trainerId) {
    const trainerUser = await getUser(env.DB, user.trainerId).catch(() => null);
    if (!trainerUser) return Response.json({ error: "not found" }, { status: 404 });
    const qid = await createQuestion(env.DB, user._id, user.trainerId, question, undefined);
    const trainerDoc = await getTrainer(env.DB, user.trainerId).catch(() => null);
    const style = trainerDoc
      ? `Match this trainer's own stated style: ${[trainerDoc.specialization, trainerDoc.approach, trainerDoc.bio].filter(Boolean).join(" | ")}. `
      : "";
    const draft = cleanAi(await aiText(env, {
      system:
        `You are drafting a reply for a human fitness trainer to send to their own client. Write as the TRAINER ` +
        `speaking directly to the client, ready to send unedited. ${style}` +
        `Never give a medical diagnosis -- for pain, injury, or medical concerns, suggest seeing a professional. ` +
        `Answer in ${trainerUser.lang === "uk" ? "Ukrainian" : "English"}. Plain text only -- no markdown, no LaTeX, no backslashes, max 10 short lines.\n\n` +
        `Client's plan: ${planText}\n` +
        `Client's last 14 days: ${workoutsDone} workout(s) completed, ${nutritionDays} day(s) of nutrition logged.\n` +
        `Today: ${date}.`,
      user: question,
      temperature: 0.7,
      kind: "coach",
      db: env.DB,
      userId: user._id,
    }).catch(() => "")).slice(0, 1500);
    if (draft) await setQuestionDraft(env.DB, qid, draft).catch(() => {});
    await tgSend(
      env,
      trainerUser.chatId,
      t(trainerUser.lang, "trainer_question", { name: user.profile.name ?? `id ${user._id}`, q: question }) + (draft ? `\n\n${escapeHtml(draft)}` : ""),
      // The trainer answers in the app (Workspace → client questions), with the AI draft there.
      appMarkup(env, t(trainerUser.lang, "nb_reply"), "role") ?? {
        inline_keyboard: [
          [{ text: t(trainerUser.lang, "q_send"), callback_data: `q:send:${qid}` }, { text: t(trainerUser.lang, "q_own"), callback_data: `q:own:${qid}` }],
          [{ text: t(trainerUser.lang, "q_skip"), callback_data: `q:skip:${qid}` }],
        ],
      },
    );
    return Response.json({ routed: true }, { headers: { "cache-control": "no-store" } });
  }

  // Solo / trainer: the same coach as the bot — full plan & engine context, a short chat memory
  // the client sends back, and plan-edit / feedback buttons the app can apply itself.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .filter((h): h is { role: string; text: string } => !!h && typeof h === "object" && typeof (h as { text?: unknown }).text === "string")
    .map((h) => `${h.role === "coach" ? "Coach" : "User"}: ${h.text.slice(0, 600)}`);
  const userMsg = history.length ? `Earlier in this chat:\n${history.join("\n")}\n\nNow: ${question}` : question;
  const knowledge = await searchKnowledge(env, env.DB, question, user.lang === "en" ? "en" : "uk");
  try {
    const result = await aiJSON<P.CoachEditResult>(env, {
      system: P.coachEditSystem(user.lang, user.profile, await coachContext({ db: env.DB }, user)) + knowledgeBlock(knowledge),
      user: userMsg,
      schema: P.COACH_EDIT_SCHEMA,
      temperature: 0.35,
      kind: "coach",
      db: env.DB,
      userId: user._id,
      validate: (parsed) => validateCoachEditResult(parsed),
    });
    return Response.json(
      { answer: cleanAi(result.reply).slice(0, 1500), actions: miniAppCoachActions(result.actions, question) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The structured call failed on every provider — still answer in plain text.
    const answer = await aiText(env, { system: system + knowledgeBlock(knowledge), user: userMsg, temperature: 0.6, kind: "coach", db: env.DB, userId: user._id }).catch(() => "");
    return Response.json({ answer: cleanAi(answer).slice(0, 1500), actions: [] }, { headers: { "cache-control": "no-store" } });
  }
}
