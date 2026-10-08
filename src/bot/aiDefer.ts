// Shared bot plumbing: the update error handler, level-up celebration, and deferAi, which
// acknowledges an AI request at once and finishes it in the background with a Thinking draft.
import { RateLimitError } from "../ai";
import { recordError } from "../adapters/d1/v2AiTelemetry";
import { startThinking } from "../adapters/telegram/thinking";
import { advanceLevel } from "../features/gamification/level";
import { t } from "../locales/i18n";
import { MyContext, reply } from "../adapters/telegram/context";

export async function onError(ctx: MyContext, err: unknown, where: string) {
  if (err instanceof RateLimitError) {
    await reply(ctx, t(ctx.user.lang, "limit_hit"));
    return;
  }
  console.error(`${where} handler error`, err);
  // Every interactive AI-driven flow (plan gen, exercise lookup, warmup suggestion, coach, …)
  // funnels through here on failure — persisting it is what makes /ownerreport → Errors reflect
  // what users actually hit, instead of only the two chart-render call sites that used to be the
  // sole source of that dashboard.
  await recordError(ctx.db, { userId: ctx.user._id, kind: where, errorType: "exception", message: String(err).slice(0, 200) }).catch(() => {});
  // For any AI-related failure show a retry hint instead of a scary generic error.
  await reply(ctx, t(ctx.user.lang, "ai_retry"));
}

// Celebrate crossing an XP level -- called after XP-earning actions (meal, check-in, steps). The
// bookkeeping (and the silent first sighting) lives in features/gamification/level.ts, shared with
// the workout save; this only decides how the chat says it.
export async function maybeCelebrateLevel(ctx: MyContext) {
  const lv = await advanceLevel(ctx.db, ctx.user);
  if (lv?.leveledUp) await reply(ctx, t(ctx.user.lang, "levelup_msg", { level: lv.level, xp: lv.xp }), undefined, "celebrate").catch(() => {});
}

// Run a conversational AI handler past the webhook response (waitUntil) so the user gets
// instant feedback ("typing…") instead of the webhook blocking for the whole AI chain
// (up to ~26 s). Errors surface through onError, same as the old inline path. None of the
// deferred flows park the session in a waiting mode, so a (rare) evicted isolate just means
// no reply — the user's next message goes through the normal route again.
/** Run an AI job past the webhook response. By default the user sees Telegram's native
 *  "Thinking…" draft until the job ends (adapters/telegram/thinking); pass thinking: false when
 *  the answer goes to someone else (a client's question routed to their trainer). */
export function deferAi(ctx: MyContext, where: string, work: () => Promise<void>, opts: { thinking?: boolean } = {}) {
  ctx.waitUntil(
    (async () => {
      const thinking = opts.thinking === false ? null : startThinking(ctx);
      if (thinking) ctx.thinking = thinking;
      try {
        await work();
      } catch (err) {
        await onError(ctx, err, where).catch(() => {});
      } finally {
        thinking?.stop();
        if (ctx.thinking === thinking) ctx.thinking = undefined;
      }
    })(),
  );
}

// Route a unit of user text (typed OR transcribed from voice) by the current session mode.
// A menu-keyboard tap takes priority over the active mode (except during onboarding).
// ---------- /checkin — subjective daily wellbeing (energy / sleep / stress, 1-5) ----------
