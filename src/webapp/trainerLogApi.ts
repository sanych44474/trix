// A trainer logging a client's workout and turning a voice command into a proposal (ADR-0018).
//   GET  /api/v2/trainer/log?clientId=&date=   the client's day, for the trainer's form (no draft)
//   POST /api/v2/trainer/log                    save the day for the client; it counts as theirs
//   POST /api/v2/trainer/voice                  text (from speech) → a workout or plan-edit proposal
// Same auth as every trainer route: a signed-in trainer, and the client must be theirs (404 otherwise,
// so "missing" and "not yours" look the same). Nothing the voice route returns is applied: the trainer
// confirms a workout through POST /log and plan edits through the plan editor's POST /api/v2/plan.
import type { Env, UserDoc } from "../types";
import { getClientForTrainer } from "../adapters/d1/v2Trainer";
import { getWorkoutLog } from "../adapters/d1/v2Workouts";
import { recordAudit } from "../adapters/d1/v2Admin";
import { rawTelegramApi } from "../adapters/telegram/rawApi";
import { HTML } from "../adapters/telegram/context";
import { aiJSON } from "../ai/index";
import { RateLimitError } from "../ai/errors";
import * as P from "../ai/prompts";
import { editDateError, isStaleBase } from "../domain/editWindow";
import { localParts } from "../domain/localTime";
import { miniAppCoachActions } from "../domain/coachActions";
import {
  normalizeVoiceEntries,
  orderPlanActions,
  quickWorkoutProposal,
  validateTrainerVoiceResult,
  type TrainerVoiceResult,
} from "../domain/trainerVoice";
import { trainerVoiceContext } from "../features/trainer/trainerVoiceContext";
import { cleanAiText, escapeHtml, t } from "../locales/i18n";
import { appMarkup } from "../notify/appKeyboard";
import { notifySafely } from "../notify/notify";
import { miniAppUser } from "./auth";
import { buildWorkoutTodayPayload, saveWorkout, validateSaveBody } from "./workout";
import { readJsonBody } from "./validate";
import { typedFailure } from "./failure";
import { apiFailure } from "./apiError";

const MAX_VOICE_TEXT = 1000;

/** The day the trainer means, checked against the CLIENT's calendar (their timezone, their 14 days). */
function clientDate(client: UserDoc, raw: unknown): { date: string; today: string } | { error: string } {
  const today = localParts(client.profile.timezone).date;
  const date = typeof raw === "string" && raw ? raw : today;
  const err = editDateError(date, today);
  return err ? { error: err } : { date, today };
}

const savedAtOf = (log: { completed: boolean; updatedAt?: Date } | null): string | null =>
  log?.completed && log.updatedAt ? log.updatedAt.toISOString() : null;

export async function handleTrainerLogApi(req: Request, url: URL, env: Env): Promise<Response> {
  const trainer = await miniAppUser(req, url, env);
  if (!trainer) return typedFailure(401, "unauthorized", "unauthorized");
  if (trainer.role !== "trainer") return typedFailure(403, "forbidden", "forbidden");
  try {
    const path = url.pathname;
    if (path === "/api/trainer/log" && req.method === "GET") {
      const client = await getClientForTrainer(env.DB, trainer._id, Number(url.searchParams.get("clientId")));
      if (!client) return typedFailure(404, "not_found", "not found");
      const day = clientDate(client, url.searchParams.get("date"));
      if ("error" in day) return typedFailure(400, "validation_error", day.error);
      const payload = await buildWorkoutTodayPayload(env.DB, client, env.WORKER_URL, env.TELEGRAM_BOT_TOKEN, day.date);
      // The client's unsaved logger is theirs: the trainer never sees or overwrites it.
      const { draft: _draft, ...rest } = payload;
      return Response.json({
        ...rest,
        client: { id: client._id, name: client.profile.name ?? `id ${client._id}`, today: day.today },
      });
    }

    if (path === "/api/trainer/log" && req.method === "POST") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = (parsed.body ?? {}) as { clientId?: unknown; date?: unknown; baseSavedAt?: unknown };
      const client = await getClientForTrainer(env.DB, trainer._id, Number(body.clientId));
      if (!client) return typedFailure(404, "not_found", "not found");
      const v = validateSaveBody(parsed.body);
      if ("error" in v) return typedFailure(400, "validation_error", v.error);
      const day = clientDate(client, body.date);
      if ("error" in day) return typedFailure(400, "validation_error", day.error);
      // The form was built from the day as it was when the trainer opened it. If the client (or another
      // device) saved the day since, replacing it blindly would wipe their sets: refuse, the app reloads.
      const base = typeof body.baseSavedAt === "string" ? body.baseSavedAt : null;
      if (isStaleBase(base, savedAtOf(await getWorkoutLog(env.DB, client._id, day.date)))) {
        return typedFailure(409, "conflict", "stale");
      }
      // Timing is the client's own session clock; the trainer's form has none.
      const result = await saveWorkout(env, client, v.entries, day.date, undefined, { loggedBy: trainer._id });
      const saved = await getWorkoutLog(env.DB, client._id, day.date);
      await recordAudit(env.DB, trainer._id, "log_workout", client._id, `${day.date} · ${v.entries.length} ex`).catch(() => {});
      const trainerName = escapeHtml(trainer.profile.name ?? "Trainer");
      const text =
        t(client.lang, "trainer_logged_workout", { trainer: trainerName, date: day.date, n: v.entries.length }) +
        (result.prExercises.length ? `\n${t(client.lang, "trainer_logged_workout_pr", { names: escapeHtml(result.prExercises.join(", ")) })}` : "");
      const replyMarkup = appMarkup(env, t(client.lang, "nb_open_train"), "train");
      // Once per client and day: a correction later the same day is silent.
      await notifySafely(env, { api: rawTelegramApi(env) }, { userId: client._id, chatId: client.chatId }, {
        kind: "trainer_logged_workout",
        key: `trainer_log:${client._id}:${day.date}`,
        text,
        extra: replyMarkup ? { ...HTML, reply_markup: replyMarkup } : HTML,
      });
      return Response.json({
        ok: true,
        prExercises: result.prExercises,
        level: result.level,
        leveledUp: result.leveledUp,
        totalWorkouts: result.totalWorkouts,
        volumeKg: result.volumeKg,
        savedAt: savedAtOf(saved),
      });
    }

    if (path === "/api/trainer/voice" && req.method === "POST") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = (parsed.body ?? {}) as { clientId?: unknown; text?: unknown; date?: unknown };
      const client = await getClientForTrainer(env.DB, trainer._id, Number(body.clientId));
      if (!client) return typedFailure(404, "not_found", "not found");
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > MAX_VOICE_TEXT) return typedFailure(400, "validation_error", "text");
      const day = clientDate(client, body.date);
      if ("error" in day) return typedFailure(400, "validation_error", day.error);
      const ctx = await trainerVoiceContext(env.DB, client);

      // Plain set dictation needs no model.
      const quick = quickWorkoutProposal(text, ctx.candidates);
      if (quick) return Response.json({ kind: "workout", transcript: text, reply: "", entries: quick });

      let result: TrainerVoiceResult;
      try {
        result = await aiJSON<TrainerVoiceResult>(env, {
          system: P.trainerVoiceSystem(trainer.lang, day.date, ctx.text),
          user: text,
          schema: P.TRAINER_VOICE_SCHEMA,
          temperature: 0.2,
          kind: "coach",
          db: env.DB,
          userId: trainer._id, // the trainer's AI allowance pays for it, not the client's
          validate: (out) => validateTrainerVoiceResult(out),
        });
      } catch (err) {
        if (err instanceof RateLimitError) return typedFailure(429, "rate_limited", "Too many requests, slow down");
        return typedFailure(502, "dependency_unavailable", "ai unavailable");
      }
      const reply = cleanAiText(result.reply).slice(0, 500);
      if (result.kind === "workout") {
        const entries = normalizeVoiceEntries(result.entries ?? [], ctx.candidates);
        if (entries.length) return Response.json({ kind: "workout", transcript: text, reply, entries });
      }
      if (result.kind === "plan" && ctx.plan) {
        const actions = orderPlanActions(miniAppCoachActions(result.actions, text, ctx.plan.split).filter((a) => a.kind !== "feedback"));
        if (actions.length) {
          return Response.json({ kind: "plan", transcript: text, reply, actions, version: ctx.plan.generatedAt.toISOString() });
        }
      }
      return Response.json({ kind: "none", transcript: text, reply });
    }

    return typedFailure(404, "not_found", "not found");
  } catch (err) {
    return apiFailure(env, "api_trainer_log", err, { userId: trainer._id });
  }
}
