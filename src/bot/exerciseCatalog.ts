// Exercises in the chat: looking one up, confirming a catalog match, AI-authored entries, localized
// names, descriptions, and adding/deleting exercises on a plan day. Split out of bot.ts (god-file
// split); bot.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import type { CatalogExercise, Lang, PlanDay, Weekday } from "../types";
import { getActivePlan, recordPlanChange, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { listActiveInjuries } from "../adapters/d1/v2Tracking";
import { getCatalogExercise, searchExercisesByName } from "../adapters/d1/v2Catalog";
import { updateUser } from "../adapters/d1/v2Users";
import { checkExerciseAgainstInjuries } from "../domain/safety";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { getPlanDay } from "../domain/progression";
import { exerciseMetric } from "../domain/setFormat";
import { menuBtn } from "../adapters/telegram/keyboards";
import { onError } from "../features/aiDefer";
import { endSelfEdit, swapExerciseByName } from "./planExerciseEdit";
import { switchMode } from "../domain/session";
import { isEditingOther, planOwnerId, planOwnerLang, reply, setMode, type MyContext } from "../adapters/telegram/context";
import { reRenderEditDay, PendingExercise } from "./planView";
import { extractExerciseQuery, defaultStartWeightForExercise, defaultSetsForMetric } from "../domain/exerciseDefaults";
import { addExerciseByName } from "./todayEdit";
import { createExerciseCatalogEntry, exerciseInfoEntry, groundExercise } from "../features/exercise/catalog";


export async function promptExerciseConfirmation(
  ctx: MyContext,
  payload: {
    action: "swap" | "add";
    weekday: Weekday;
    query: string;
    englishQuery: string;
    catalog: CatalogExercise;
    index?: number;
    source?: "ai_coach" | "manual";
  },
) {
  const lang = ctx.user.lang;
  const localized = lang === "en" ? payload.catalog.name : (await exerciseInfoEntry(ctx, payload.catalog.id, lang))?.name ?? payload.catalog.name;
  const session = switchMode(ctx.user.session, "exercise_confirm", {
    pendingExercise: {
      action: payload.action,
      weekday: payload.weekday,
      index: payload.index,
      query: payload.query,
      englishQuery: payload.englishQuery,
      catalogId: payload.catalog.id,
      source: payload.source,
    },
  });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const kb = new InlineKeyboard()
    .text(t(lang, "confirm_yes"), "ex:yes")
    .text(t(lang, "confirm_no"), "ex:no");
  await reply(ctx, t(lang, "exercise_confirm_question", { name: localized }), kb);
}

// After a swap/add, offer the new exercise's weight & sets right away — the replacement
// almost always needs different numbers, and these are the same wt:/st: flows the day editor uses.
export function swapTuneKb(lang: Lang, weekday: Weekday, index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "plan_diff_edit_weight"), `wt:${weekday}:${index}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:${weekday}:${index}`);
}

export async function applyCatalogExerciseChoice(
  ctx: MyContext,
  payload: NonNullable<MyContext["user"]["session"]["pendingExercise"]>,
  catalog: CatalogExercise,
) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const day = getPlanDay(plan, payload.weekday);
  if (!day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // AI-coach and manual add/swap both land here — the single place that actually writes the new
  // exercise into the plan, so it's the right gate for "AI proposes, domain logic decides": a
  // DIRECT conflict with an active injury (same rule the injury-report auto-swap already uses)
  // blocks the write instead of silently applying it. Related-only conflicts still go through.
  const activeInjuries = await listActiveInjuries(ctx.db, planOwnerId(ctx));
  if (activeInjuries.length) {
    const conflict = checkExerciseAgainstInjuries({ name: catalog.name, muscles: catalog.muscle }, activeInjuries);
    if (conflict.blocked && conflict.area) {
      const areaLabel = t(lang, `inj_area_${conflict.area}` as Parameters<typeof t>[1]);
      await reply(ctx, t(lang, "safety_exercise_blocked_injury", { name: catalog.name, area: areaLabel }), menuBtn(lang));
      return;
    }
  }
  // Localize the single new exercise directly from the (cached) catalog translation — the same
  // entry the confirmation showed. This is deterministic and avoids running the whole split
  // through the bulk AI translator, which could fail and leave the exercise in English.
  const oLang = await planOwnerLang(ctx);
  const info = oLang === "en" ? null : await exerciseInfoEntry(ctx, catalog.id, oLang).catch(() => null);
  const exName = info?.name || catalog.name;
  const exTech = info?.instructions || catalog.instructions;
  // Classify the NEW exercise by its canonical name so a plank/cardio swapped or added via the
  // catalog gets the right metric + sensible default sets — not the reps scheme it replaced.
  const metric = exerciseMetric({ name: catalog.name });
  const timed = metric !== "reps";
  let fromName = "";
  if (payload.action === "swap") {
    const current = payload.index !== undefined ? day.exercises[payload.index] : undefined;
    if (!current) {
      await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
      return;
    }
    fromName = current.name;
    day.exercises[payload.index!] = {
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      // Keep the rep scheme for a like-for-like reps swap, but never carry the old absolute load
      // (e.g. a 100 kg back squat → goblet squat). Timed/cardio get their own default sets.
      sets: timed ? defaultSetsForMetric(metric, catalog) : current.sets,
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech || current.technique,
      isKeyLift: timed ? false : current.isKeyLift,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    };
  } else {
    day.exercises.push({
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      sets: defaultSetsForMetric(metric, catalog),
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech,
      isKeyLift: false,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    });
  }

  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);

  const updatedDay = plan.split.find((d) => d.weekday === payload.weekday);
  if (payload.action === "swap") {
    const swapped = updatedDay?.exercises[payload.index ?? 0];
    await recordPlanChange(ctx.db, planOwnerId(ctx), payload.source ?? "manual", `swap: ${fromName} -> ${swapped?.name ?? catalog.name}`).catch(() => {});
    await reply(
      ctx,
      t(lang, "swap_done", { from: fromName, to: swapped?.name ?? catalog.name }),
      swapTuneKb(lang, payload.weekday, payload.index ?? 0),
    );
  } else {
    await recordPlanChange(ctx.db, planOwnerId(ctx), payload.source ?? "manual", `add: ${updatedDay?.exercises.at(-1)?.name ?? catalog.name}`).catch(() => {});
    await reply(
      ctx,
      t(lang, "add_exercise_done", { name: updatedDay?.exercises.at(-1)?.name ?? catalog.name }),
      updatedDay ? swapTuneKb(lang, payload.weekday, updatedDay.exercises.length - 1) : undefined,
    );
  }
  // Re-show the full edit-day menu automatically after an add / custom swap (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, payload.weekday);
  else await endSelfEdit(ctx, String(payload.weekday));
}

export async function handleExerciseConfirmation(ctx: MyContext, accept: boolean) {
  const lang = ctx.user.lang;
  const pending = ctx.user.session.pendingExercise;
  if (!pending) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // "✅ Так" → add the resolved catalog exercise.
  if (accept) {
    await setMode(ctx, "idle");
    if (pending.catalogId) {
      const catalog = await getCatalogExercise(ctx.db, pending.catalogId);
      if (catalog) {
        await applyCatalogExerciseChoice(ctx, pending, catalog);
        return;
      }
    }
    // Accepted, but the suggestion had no stored catalog entry (rare) — author it.
    await aiAuthorAndAdd(ctx, pending);
    return;
  }
  // "✏️ Ні, інша вправа" → don't guess: offer real catalog alternatives for the user's query,
  // plus "type another name" and an explicit "let the bot create it" fallback. Nothing is
  // added until the user picks.
  await showExerciseConfirmAlternatives(ctx, pending);
}

// AI-author one exercise from the user's free-text query and add it. Used only when the user
// explicitly asks the bot to create it (no catalog match they liked).
export async function aiAuthorAndAdd(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, pending.weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const current = pending.action === "swap" && pending.index !== undefined ? day.exercises[pending.index] : undefined;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = await createExerciseCatalogEntry(ctx, pending.query, day, pending.action, current, pending.englishQuery, pending.catalogId);
    await applyCatalogExerciseChoice(ctx, pending, catalog);
  } catch (err) {
    await onError(ctx, err, "exercise_confirm");
  }
}

// Show other library matches for the user's query (the rejected suggestion excluded). Keeps the
// pending request in the session and switches to "exercise_alt" mode so a typed reply re-searches.
export async function showExerciseConfirmAlternatives(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "exercise_alt", { pendingExercise: pending });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;

  // Re-use the already-resolved English query / original query — no extra AI translate call.
  const variants = [...new Set([pending.englishQuery, pending.query].map((q) => q.trim()).filter(Boolean))];
  let matches: CatalogExercise[] = [];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, 6, lang);
    if (found.length) { matches = found; break; }
  }
  const alts = matches.filter((m) => m.id !== pending.catalogId).slice(0, 4);

  if (!alts.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "exercise_alt_type_btn"), "exa:type")
      .row()
      .text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
    await reply(ctx, t(lang, "exercise_alt_none"), kb);
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of alts) {
    // Localizing each label is best-effort — a translate failure must not crash the menu.
    let name = c.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    kb.text(cleanAi(name).slice(0, 60), `exa:pick:${c.id}`).row();
  }
  kb.text(t(lang, "exercise_alt_type_btn"), "exa:type").row();
  kb.text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
  await reply(ctx, t(lang, "exercise_alt_pick"), kb);
}

// Text handler for "exercise_alt": a typed reply is a fresh exercise name → re-run the
// add/swap-by-name flow (which prompts confirmation again).
export async function handleExerciseAltText(ctx: MyContext, text: string) {
  const pending = ctx.user.session.pendingExercise;
  await setMode(ctx, "idle");
  if (!pending) {
    await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang));
    return;
  }
  const query = extractExerciseQuery(text);
  if (pending.action === "swap" && pending.index !== undefined) {
    await swapExerciseByName(ctx, pending.weekday, pending.index, query);
  } else {
    await addExerciseByName(ctx, pending.weekday, query);
  }
}

// Send full 📖 instructions + ⚠️ safety for EVERY exercise of a day as a separate message.
// Exercises that aren't catalog-grounded yet are grounded on demand (match or AI-author) and
// the new ids are persisted so info works for all of them. Each block is a single-line
// <b>name</b> header + plain escaped text → sendLong can chunk safely (no entity spans a chunk).
export async function sendExerciseDescriptions(ctx: MyContext, dayArg: PlanDay, lang: Lang) {
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan?.split.find((d) => d.weekday === dayArg.weekday) ?? dayArg;
  if (!day.exercises.length) return;

  // Ground any ungrounded exercises (in parallel), then persist if anything changed.
  const ungrounded = day.exercises.filter((e) => !e.exerciseId);
  if (ungrounded.length) {
    const grounds = await Promise.all(ungrounded.map((e) => groundExercise(ctx, day, e)));
    let changed = false;
    ungrounded.forEach((e, i) => {
      const g = grounds[i];
      if (g) {
        e.exerciseId = g.id;
        e.canonicalName = g.name;
        changed = true;
      }
    });
    if (changed && plan) await updateActivePlanSplit(ctx.db, ctx.user._id, plan.split);
  }

  const results = await Promise.all(
    day.exercises.map((e) => (e.exerciseId ? exerciseInfoEntry(ctx, e.exerciseId, lang) : null)),
  );
  const blocks: string[] = [];
  day.exercises.forEach((e, i) => {
    const r = results[i];
    const instr = (r?.instructions ?? "").replace(/\s+/g, " ").trim();
    const safety = (r?.safety ?? "").replace(/\s+/g, " ").trim();
    let b = `📖 <b>${escapeHtml(cleanAi(r?.name || e.name))}</b>`;
    if (instr) b += `\n${escapeHtml(instr)}`;
    if (safety) b += `\n⚠️ ${escapeHtml(safety)}`;
    blocks.push(b);
  });
  if (blocks.length) await reply(ctx, blocks.join("\n\n"));
}
