// Plan authoring — the app's deepest module: AI interview retry, bank fallback, plan build /
// heal / translate, dynamic progression regeneration. Extracted from bot.ts (god-file split);
// behavior unchanged.
import { InlineKeyboard } from "grammy";
import type { Lang, PlanDoc, UserDoc, Weekday } from "../types";
import type { MyContext } from "../adapters/telegram/context";
import { HTML, reply } from "../adapters/telegram/context";
import { localizePlanNames } from "../features/exercise/catalog";
import { saveBaselineBody } from "./planGen";
import { videosForDays } from "../features/plan/exerciseVideos";
import { mainMenu, menuBtn, planActionsKb } from "../adapters/telegram/keyboards";
import { logInfo } from "../log";
import { recordPlanSource } from "../adapters/d1/v2Analytics";
import { listStrength } from "../adapters/d1/v2Workouts";
import { getActivePlan, listPlanBank, recentAdjustments, saveDraftPlan, setActivePlan } from "../adapters/d1/v2Plans";
import { getTrainer } from "../adapters/d1/v2Trainer";
import { getUser, stampOnboardedAt, updateUser } from "../adapters/d1/v2Users";
import { trainerStyleBlock } from "../features/trainer/trainerWizard";
import { adaptPlan } from "../domain/planAdapt";
import { exerciseCountLimits } from "../domain/plan-lint";
import { MATCH_THRESHOLD, selectBest } from "../domain/planBank";
import { formatRecordBest } from "../domain/setFormat";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { renderPlan } from "../render";
import { RateLimitError } from "../ai/errors";
import { buildPlanDoc, resolveDislikedSwaps } from "../features/plan/planBuild";

import { bankFallbackPlan } from "../features/plan/planService";

// Client finished onboarding under a trainer: build an AI DRAFT for the trainer to review
// (not activated), mark the client onboarded, and notify the trainer.
export async function generateClientDraft(ctx: MyContext, profile: UserDoc["profile"]) {
  const lang = ctx.user.lang;
  const wasOnboarded = ctx.user.onboarded; // captured before any mutation below -- see docs/slos.md
  await reply(ctx, t(lang, "client_plan_generating"));
  await ctx.replyWithChatAction("typing").catch(() => {});
  try {
    // Bias the AI draft toward the supervising trainer's stated style (specialization/approach).
    const trainerDoc = ctx.user.trainerId ? await getTrainer(ctx.db, ctx.user.trainerId) : null;
    const trainerStyle = trainerDoc ? trainerStyleBlock(trainerDoc) : undefined;
    let plan: PlanDoc;
    try {
      plan = await buildPlanDoc(ctx, lang, profile, ctx.user._id, {
        authoredBy: ctx.user.trainerId,
        trainerStyle,
      });
    } catch (aiErr) {
      // AI chain down/rate-limited — serve the best bank archetype as the draft rather than
      // stranding a finished client interview in plan_pending. Trainer can still edit before assigning.
      const fb = await bankFallbackPlan(ctx.db, lang, profile, ctx.user._id, ctx.user.trainerId ?? undefined);
      if (!fb) throw aiErr; // no archetype → let the outer catch park for a later retry
      console.error("generateClientDraft AI failed — served bank archetype", ctx.user._id, aiErr);
      plan = fb;
    }
    await saveDraftPlan(ctx.db, plan);
    // Draft only, not activated -- first_plan_ready (docs/slos.md) is defined as the first
    // setActivePlan, which never happens on this trainer-review path.
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      nutrition: plan.nutrition,
      profile: {
        ...profile,
        trainingWeekdays:
          profile.trainingWeekdays?.length ? profile.trainingWeekdays : (plan.split.map((d) => d.weekday) as Weekday[]),
      },
      session: { mode: "idle" },
    });
    await saveBaselineBody(ctx, profile);
    await reply(ctx, t(lang, "client_plan_pending"), menuBtn(lang));
    // Notify the trainer. If the client already trains on a plan (e.g. one the trainer made
    // from the mini-interview), frame the fresh draft as a REVISION proposal based on the
    // now-complete interview answers rather than a first draft.
    const trainer = ctx.user.trainerId ? await getUser(ctx.db, ctx.user.trainerId) : null;
    if (trainer) {
      const hadPlan = !!(await getActivePlan(ctx.db, ctx.user._id).catch(() => null));
      const who = escapeHtml(profile.name ?? `id ${ctx.user._id}`);
      const kb = new InlineKeyboard()
        .text(t(trainer.lang, "cc_plan"), `cl:${ctx.user._id}:plan`)
        .text(t(trainer.lang, "cc_assign"), `cl:${ctx.user._id}:assign`);
      const key = hadPlan ? "trainer_client_interview_revised" : "trainer_client_draft_ready";
      await ctx.api
        .sendMessage(trainer.chatId, t(trainer.lang, key, { name: who }), { ...HTML, reply_markup: kb })
        .catch(() => {});
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      await updateUser(ctx.db, ctx.user._id, { profile, session: { mode: "plan_pending" } });
      await reply(ctx, t(lang, "limit_hit"));
      return;
    }
    console.error("client draft failed", err);
    // Interview is genuinely done even though plan generation failed entirely (the plan-pending
    // recovery sweep will retry) -- onboarded flips true here too, so the event fires here too.
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      profile,
      session: { mode: "plan_pending" },
    });
    await reply(ctx, t(lang, "client_plan_pending"));
  }
}

// Build a plan for a user: prefer a pre-generated bank archetype (zero AI) when one matches
// well; otherwise fall back to full Gemini generation. `forceAi` skips the bank (the user
// asked for an AI plan via the button).
export async function buildPlanForUser(
  ctx: MyContext,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; forceAi?: boolean } = {},
): Promise<{ plan: PlanDoc; source: "bank" | "ai" }> {
  // Score the closest bank archetype once — used both for the zero-AI primary path (a strong
  // match) and as the emergency fallback (any match) when AI generation fails/times out.
  let match: ReturnType<typeof selectBest> = null;
  try {
    match = selectBest(await listPlanBank(ctx.db), profile, forUserId);
  } catch (err) {
    console.error("bank plan selection failed", err);
  }
  const fromBank = async (): Promise<{ plan: PlanDoc; source: "bank" }> => {
    const bankPlan = match!.entry.plan[lang === "en" ? "en" : "uk"];
    const replacements = await resolveDislikedSwaps(ctx.db, lang, bankPlan.split, profile).catch(() => new Map());
    const plan = adaptPlan(bankPlan, profile, forUserId, { prs: opts.prs, replacements, authoredBy: opts.authoredBy, finishFor: lang === "en" ? "en" : "uk" });
    await localizePlanNames(ctx, plan, lang);
    await recordPlanSource(ctx.db, forUserId, "workout", "bank").catch(() => {});
    return { plan, source: "bank" };
  };
  if (!opts.forceAi && match && match.score >= MATCH_THRESHOLD) {
    try { return await fromBank(); } catch (err) { console.error("bank adapt failed, falling back to AI", err); }
  }
  try {
    const plan = await buildPlanDoc(ctx, lang, profile, forUserId, { prs: opts.prs, authoredBy: opts.authoredBy });
    await recordPlanSource(ctx.db, forUserId, "workout", "ai").catch(() => {});
    return { plan, source: "ai" };
  } catch (err) {
    // AI down (e.g. every provider timed out). Rather than strand the user in plan_pending,
    // serve the best available bank archetype regardless of match score.
    if (match) {
      console.error("AI plan gen failed — serving best-effort bank archetype", err);
      return await fromBank();
    }
    throw err; // no bank to fall back on — let the caller retry later
  }
}

// Lazy self-heal: if an AI-coached plan is degenerate (a training day with fewer than
// the exercise minimum for this client's session budget), silently rebuild it with the
// now-validated generator and notify once. Trainer-managed client plans are left untouched.
// On any AI failure the original plan is kept (no data loss). Returns the plan to show.
export async function healPlanIfDegenerate(ctx: MyContext, plan: PlanDoc): Promise<PlanDoc> {
  if (ctx.user.role === "client") return plan;
  const limits = exerciseCountLimits(ctx.user.profile);
  const degenerate = plan.split.some((d) => (d.exercises?.length ?? 0) < limits.min);
  if (!degenerate) return plan;
  try {
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const fresh = await buildPlanDoc(ctx, ctx.user.lang, ctx.user.profile, ctx.user._id, {
      prs,
      authoredBy: plan.authoredBy,
    });
    await setActivePlan(ctx.db, fresh);
    await updateUser(ctx.db, ctx.user._id, { nutrition: fresh.nutrition });
    ctx.user.nutrition = fresh.nutrition;
    await reply(ctx, t(ctx.user.lang, "plan_healed"));
    return fresh;
  } catch (err) {
    console.error("healPlanIfDegenerate failed", ctx.user._id, err);
    return plan;
  }
}

// Free-tier async: ack instantly, park the user as plan_pending (so the every-minute cron
// heals it if the background task is evicted), then run the heavy AI in waitUntil. The
// webhook returns immediately instead of blocking ~1-10s on generation.
export async function generatePlan(ctx: MyContext, profile: UserDoc["profile"], prs?: string) {
  const lang = ctx.user.lang;
  await reply(ctx, t(lang, "plan_generating"));
  await updateUser(ctx.db, ctx.user._id, { profile, session: { mode: "plan_pending" } });
  ctx.user.session = { ...ctx.user.session, mode: "plan_pending" };
  ctx.waitUntil(deliverPlan(ctx, profile, prs));
}

// Heavy plan build + activation + delivery. Runs in the background (waitUntil) or, if that
// dies, is re-run by the cron plan-pending sweep (finalizeOnboardingPlan). On success it
// flips mode→idle so the sweep won't double-process.
export async function deliverPlan(ctx: MyContext, profile: UserDoc["profile"], prs?: string) {
  const lang = ctx.user.lang;
  const wasOnboarded = ctx.user.onboarded; // captured before any mutation below -- see docs/slos.md
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const { plan, source } = await buildPlanForUser(ctx, lang, profile, ctx.user._id, { prs });
    const split = plan.split;
    await setActivePlan(ctx.db, plan);
    if (!wasOnboarded) {
      logInfo("onboarding_completed", { role: ctx.user.role });
      logInfo("first_plan_ready", { source });
      await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
    }
    await updateUser(ctx.db, ctx.user._id, {
      onboarded: true,
      nutrition: plan.nutrition,
      profile: {
        ...profile,
        trainingWeekdays:
          profile.trainingWeekdays && profile.trainingWeekdays.length
            ? profile.trainingWeekdays
            : (split.map((d) => d.weekday) as Weekday[]),
      },
      session: { mode: "idle" },
    });
    await saveBaselineBody(ctx, profile);
    await reply(ctx, t(lang, "plan_ready"), mainMenu(lang));
    // A bank plan is instant; offer a one-tap AI regeneration. An AI plan already used Gemini.
    const kb = source === "bank" ? planActionsKb(lang) : menuBtn(lang);
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), kb);
  } catch (err) {
    // Leave mode=plan_pending — the cron plan-pending sweep retries silently (no error spam).
    console.error("deliverPlan failed", ctx.user._id, err);
  }
}

// "Generate with AI" button under a bank plan → rebuild via Gemini and replace the active plan.
export async function onPlanRegenAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.user.role === "client") return; // clients follow their trainer's plan
  await reply(ctx, t(lang, "plan_generating"));
  ctx.waitUntil(regenPlanAi(ctx));
}

export async function regenPlanAi(ctx: MyContext) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const plan = await buildPlanDoc(ctx, lang, ctx.user.profile, ctx.user._id, { prs });
    await setActivePlan(ctx.db, plan);
    await updateUser(ctx.db, ctx.user._id, { nutrition: plan.nutrition });
    ctx.user.nutrition = plan.nutrition;
    await reply(ctx, t(lang, "plan_ready"), mainMenu(lang));
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), menuBtn(lang));
  } catch (err) {
    console.error("regenPlanAi failed", ctx.user._id, err);
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang)).catch(() => {});
  }
}

// Rebuild the active plan from the bank for an updated profile (level-up / goal switch) and
// deliver it. Shared by the level-up and goal-reached transitions.
export async function regenBankPlan(ctx: MyContext, profile: UserDoc["profile"], doneKey: string) {
  const lang = ctx.user.lang;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const records = await listStrength(ctx.db, ctx.user._id, 8);
    const prs = records.length
      ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
      : undefined;
    const { plan } = await buildPlanForUser(ctx, lang, profile, ctx.user._id, { prs });
    await setActivePlan(ctx.db, plan);
    await updateUser(ctx.db, ctx.user._id, { nutrition: plan.nutrition });
    ctx.user.nutrition = plan.nutrition;
    await reply(ctx, t(lang, doneKey as Parameters<typeof t>[1]), mainMenu(lang));
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)), planActionsKb(lang));
  } catch (err) {
    console.error("regenBankPlan failed", ctx.user._id, err);
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang)).catch(() => {});
  }
}

// "What changed in my plan, and why" — the bi-weekly adaptive check-in (router.ts's
// handleAdaptiveCheckin) has always RECORDED every micro-adjustment it makes, reason field and
// all, but recentAdjustments() had zero callers: the automation was invisible to the person it
// was adapting for. docs/feature-audit.md flags exactly this silent-automation problem as a
// likely churn cause, so this surfaces the trail the bot was already keeping.
export async function cmdPlanChanges(ctx: MyContext) {
  const lang = ctx.user.lang;
  const rows = await recentAdjustments(ctx.db, ctx.user._id, 10).catch(() => []);
  if (!rows.length) {
    await reply(ctx, t(lang, "plan_changes_none"), menuBtn(lang));
    return;
  }
  const lines: string[] = [t(lang, "plan_changes_title")];
  for (const row of rows) {
    // Stored as the raw AdaptiveResult["adjustments"] array. A row written by an older/odd
    // shape must not break the whole history — skip what doesn't parse into entries.
    let adjustments: { weekday?: number; index?: number; sets?: string; startWeight?: string; reason?: string }[] = [];
    try {
      const parsed = JSON.parse(row.changes) as unknown;
      if (Array.isArray(parsed)) adjustments = parsed;
    } catch {
      continue;
    }
    if (!adjustments.length) continue;
    const date = row.ts.toISOString().slice(0, 10);
    lines.push("", `<b>${date}</b> · ${t(lang, "plan_changes_week", { n: row.week })}`);
    for (const a of adjustments.slice(0, 6)) {
      const what = [a.sets, a.startWeight].filter(Boolean).join(" · ");
      const why = a.reason ? ` — <i>${escapeHtml(cleanAi(a.reason))}</i>` : "";
      if (what) lines.push(`• ${escapeHtml(cleanAi(what))}${why}`);
      else if (a.reason) lines.push(`• ${escapeHtml(cleanAi(a.reason))}`);
    }
  }
  // Every row was unparseable/empty → same as having no history at all.
  if (lines.length === 1) {
    await reply(ctx, t(lang, "plan_changes_none"), menuBtn(lang));
    return;
  }
  await reply(ctx, lines.join("\n"), menuBtn(lang));
}
