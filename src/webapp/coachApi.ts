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
// A client with a human trainer (handleCoach's client branch) gets a different, async flow --
// their question is routed to the trainer with an AI-drafted reply for the trainer to send. That's
// a separate human-in-the-loop feature and stays bot-only; this route is solo/trainer self-coach
// Q&A only (403 for a client with a trainer).
import { aiText } from "../ai/index";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getRecentContext } from "../adapters/d1/v2Admin";
import { localParts } from "../domain/progression";
import { cleanAi } from "../locales/i18n";
import { weekdayName } from "../render";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import type { Env } from "../types";

const MAX_QUESTION = 500;

export async function handleCoachApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (url.pathname !== "/api/coach/ask") return Response.json({ error: "not found" }, { status: 404 });
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  if (user.role === "client" && user.trainerId) return Response.json({ error: "forbidden" }, { status: 403 });

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
  const answer = await aiText(env, {
    system,
    user: question,
    temperature: 0.6,
    kind: "coach",
    db: env.DB,
    userId: user._id,
  }).catch(() => "");
  return Response.json({ answer: cleanAi(answer).slice(0, 1500) }, { headers: { "cache-control": "no-store" } });
}
