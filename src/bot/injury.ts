// Injury / pain tracking: report pain by area/severity, auto-swap conflicting exercises for
// safe ones, scheduled pain-score follow-ups, and the recovery/restore flow. Extracted from
// bot.ts (god-file split; same barrel seam via bot.ts's `export * from "./bot/injury"`).
import { InlineKeyboard } from "grammy";
import type { InjurySwap } from "../types";
import {
  appendInjuryCheckin, createInjury, extendInjury, getActiveInjuryByArea, getActivePlan, getExerciseTranslation,
  getInjury, getUser, listActiveInjuries, listCandidatesByMuscles, resolveInjury, updateActivePlanSplit, updateInjury,
} from "../db/repos";
import { INJURY_AREAS, checkAfterDate, conflictingSlots, isSafeCandidate, restorable, safeMusclesFor, type InjuryArea, type Severity } from "../domain/injury";
import { localParts } from "../domain/progression";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { type MyContext, type TKey, HTML, menuBtn, reply } from "../bot";

export const INJURY_AREA_LABEL: Record<string, TKey> = {
  shoulder: "inj_area_shoulder", elbow: "inj_area_elbow", wrist: "inj_area_wrist",
  lower_back: "inj_area_lower_back", knee: "inj_area_knee", hip: "inj_area_hip",
  ankle: "inj_area_ankle", neck: "inj_area_neck",
};
export const areaLabelKey = (area: string): TKey => INJURY_AREA_LABEL[area] ?? "inj_area_shoulder";

export async function showInjuryMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  const active = await listActiveInjuries(ctx.db, ctx.user._id);
  const kb = new InlineKeyboard();
  for (const inj of active) {
    kb.text(t(lang, "inj_recovered_btn", { area: t(lang, areaLabelKey(inj.area)) }).slice(0, 60), `inj:ok:${inj.id}`).row();
  }
  kb.text(t(lang, "inj_report_pain_btn"), "inj:report").row().text(t(lang, "back"), "menu:settings");
  const body = active.length
    ? t(lang, "inj_active_title") + "\n" + active.map((i) => `• ${t(lang, areaLabelKey(i.area))} (${t(lang, i.severity === "strong" ? "inj_sev_strong" : "inj_sev_mild")})`).join("\n")
    : t(lang, "inj_none");
  await reply(ctx, body, kb);
}

export async function showInjuryAreas(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  INJURY_AREAS.forEach((a, i) => {
    kb.text(t(lang, areaLabelKey(a)), `inj:a:${a}`);
    if ((i + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "set:injury");
  await reply(ctx, t(lang, "inj_pick_area"), kb);
}

export async function showInjurySeverity(ctx: MyContext, area: string) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard()
    .text(t(lang, "inj_sev_mild"), `inj:s:${area}:mild`)
    .text(t(lang, "inj_sev_strong"), `inj:s:${area}:strong`);
  await reply(ctx, t(lang, "inj_pick_sev", { area: t(lang, areaLabelKey(area)) }), kb);
}

// Insert or update (same-area re-report) the active injury row.
export async function saveInjury(ctx: MyContext, area: string, severity: string, checkAfter: string, swaps: InjurySwap[]) {
  const existing = await getActiveInjuryByArea(ctx.db, ctx.user._id, area);
  if (existing) await updateInjury(ctx.db, existing.id, { area, severity, checkAfter, swaps });
  else await createInjury(ctx.db, { userId: ctx.user._id, area, severity, checkAfter, swaps });
}

export async function reportInjury(ctx: MyContext, area: InjuryArea, severity: Severity) {
  const lang = ctx.user.lang;
  const uid = ctx.user._id;
  const { date } = localParts(ctx.user.profile.timezone);
  const checkAfter = checkAfterDate(date, severity);
  const areaLabel = t(lang, areaLabelKey(area));

  // A client's plan is trainer-owned — never silently mutate it; record + notify the trainer.
  if (ctx.user.role === "client") {
    await saveInjury(ctx, area, severity, checkAfter, []);
    if (ctx.user.trainerId) {
      const trainer = await getUser(ctx.db, ctx.user.trainerId);
      if (trainer) {
        const who = ctx.user.profile.name ?? `id ${uid}`;
        const kb = new InlineKeyboard().text(t(trainer.lang, "cc_open_card"), `cl:${uid}:card`);
        await ctx.api.sendMessage(trainer.chatId, t(trainer.lang, "inj_client_notify", { name: who, area: t(trainer.lang, areaLabelKey(area)), sev: t(trainer.lang, severity === "strong" ? "inj_sev_strong" : "inj_sev_mild") }), { ...HTML, reply_markup: kb }).catch(() => {});
      }
    }
    await reply(ctx, t(lang, "inj_saved_client", { area: areaLabel }), menuBtn(lang));
    return;
  }

  const plan = await getActivePlan(ctx.db, uid);
  if (!plan || !plan.split.length) {
    await saveInjury(ctx, area, severity, checkAfter, []);
    await reply(ctx, t(lang, "inj_saved_noplan", { area: areaLabel }), menuBtn(lang));
    return;
  }
  const slots = conflictingSlots(plan.split, area, severity);
  if (!slots.length) {
    await saveInjury(ctx, area, severity, checkAfter, []);
    await reply(ctx, t(lang, "inj_saved_noswap", { area: areaLabel }), menuBtn(lang));
    return;
  }

  // Replacement pool: safe-muscle catalog candidates not already in the plan.
  const used = new Set<string>();
  for (const d of plan.split) for (const e of d.exercises) used.add((e.canonicalName ?? e.name).toLowerCase());
  const candidates = (await listCandidatesByMuscles(ctx.db, safeMusclesFor(area), { level: ctx.user.profile.level }))
    .filter((c) => isSafeCandidate(c, area) && !used.has(c.name.toLowerCase()));

  const swaps: InjurySwap[] = [];
  const swappedLines: string[] = [];
  const leftLines: string[] = [];
  let ci = 0;
  for (const slot of slots) {
    const day = plan.split.find((d) => d.weekday === slot.weekday);
    const original = day?.exercises[slot.index];
    if (!day || !original) continue;
    const alt = candidates[ci];
    if (!alt) { leftLines.push(original.name); continue; }
    ci++;
    used.add(alt.name.toLowerCase());
    let name = alt.name;
    let technique = cleanAi(alt.instructions || original.technique || "");
    if (lang !== "en") {
      const tr = await getExerciseTranslation(ctx.db, alt.id, "uk").catch(() => null);
      if (tr) { name = tr.name; technique = cleanAi(tr.instructions); }
    }
    day.exercises[slot.index] = {
      name, sets: original.sets, startWeight: "—", technique,
      exerciseId: alt.id, canonicalName: alt.name, muscles: alt.muscle,
      role: original.role, rest: original.rest,
    };
    swaps.push({ weekday: slot.weekday, index: slot.index, original, replacementCanonical: name });
    swappedLines.push(t(lang, "inj_swap_line", { from: original.name, to: name }));
  }

  if (swaps.length) await updateActivePlanSplit(ctx.db, uid, plan.split);
  await saveInjury(ctx, area, severity, checkAfter, swaps);

  let body = t(lang, "inj_saved_swaps", { area: areaLabel, n: swaps.length });
  if (swappedLines.length) body += "\n\n" + swappedLines.join("\n");
  if (leftLines.length) body += "\n\n" + t(lang, "inj_swap_reduce", { list: leftLines.map(escapeHtml).join(", ") });
  await reply(ctx, body, menuBtn(lang));
}

export async function onInjuryRecovered(ctx: MyContext, id: number) {
  const lang = ctx.user.lang;
  const inj = await getInjury(ctx.db, id);
  if (!inj || inj.userId !== ctx.user._id) { await reply(ctx, t(lang, "error_generic")); return; }
  // Restore originals where the slot still holds the replacement we put there.
  let restored = 0;
  if (inj.swaps.length && ctx.user.role !== "client") {
    const plan = await getActivePlan(ctx.db, ctx.user._id);
    if (plan) {
      for (const s of inj.swaps) {
        const day = plan.split.find((d) => d.weekday === s.weekday);
        const cur = day?.exercises[s.index];
        if (day && cur && restorable(cur.canonicalName ?? cur.name, s.replacementCanonical)) {
          day.exercises[s.index] = s.original;
          restored++;
        }
      }
      if (restored) await updateActivePlanSplit(ctx.db, ctx.user._id, plan.split);
    }
  }
  await resolveInjury(ctx.db, id);
  await reply(ctx, t(lang, restored ? "inj_restored" : "inj_recovered_done", { n: restored }), menuBtn(lang));
}

export async function onInjuryExtend(ctx: MyContext, id: number) {
  const lang = ctx.user.lang;
  const inj = await getInjury(ctx.db, id);
  if (!inj || inj.userId !== ctx.user._id) { await reply(ctx, t(lang, "error_generic")); return; }
  const { date } = localParts(ctx.user.profile.timezone);
  await extendInjury(ctx.db, id, checkAfterDate(date, "mild")); // +7 days
  await reply(ctx, t(lang, "inj_extended"), menuBtn(lang));
}

// Numeric pain check-in — richer than binary OK/more. Score 0..10; the four preset buttons
// map to 0/3/6/8 so the follow-up prompt stays one tap. Extends or resolves based on score,
// and records a longitudinal `checkinsHistory` row that powers the "🩹 Pain trend" screen.
export async function onInjuryScore(ctx: MyContext, id: number, score: number) {
  const lang = ctx.user.lang;
  const inj = await getInjury(ctx.db, id);
  if (!inj || inj.userId !== ctx.user._id) { await reply(ctx, t(lang, "error_generic")); return; }
  const clamped = Math.max(0, Math.min(10, Math.round(score)));
  const { date } = localParts(ctx.user.profile.timezone);
  await appendInjuryCheckin(ctx.db, id, { date, score: clamped });
  if (clamped === 0) {
    // Score 0 == fully OK: fall through the existing recovered flow so plan swaps get reverted.
    await onInjuryRecovered(ctx, id);
    return;
  }
  // Severe pain → longer window before re-asking, so we don't nag while it's still bad.
  const nextCheck = checkAfterDate(date, clamped >= 7 ? "strong" : "mild");
  await extendInjury(ctx.db, id, nextCheck);
  const kb = new InlineKeyboard().text(t(lang, "inj_trend_btn"), `inj:trend:${id}`);
  await reply(ctx, t(lang, clamped >= 7 ? "inj_score_severe" : "inj_score_ack", { score: clamped }), kb);
}

// Recent pain scores for one injury — the "how has my knee trended?" answer. Renders the
// last 12 check-ins as a compact ledger; no chart libraries needed (Telegram won't render them).
export async function showInjuryTrend(ctx: MyContext, id: number) {
  const lang = ctx.user.lang;
  const inj = await getInjury(ctx.db, id);
  if (!inj || inj.userId !== ctx.user._id) { await reply(ctx, t(lang, "error_generic")); return; }
  const areaLabel = t(lang, `inj_area_${inj.area}` as Parameters<typeof t>[1]);
  const history = [...inj.checkinsHistory].slice(-12);
  const body =
    history.length === 0
      ? t(lang, "inj_trend_empty", { area: areaLabel })
      : `${t(lang, "inj_trend_title", { area: areaLabel })}\n` +
        history.map((h) => `• ${h.date}: ${h.score}/10 ${scoreEmoji(h.score)}`).join("\n");
  await reply(ctx, body, menuBtn(lang));
}

// Small helper — 4-bucket emoji for a pain score, so the trend line reads at a glance.
function scoreEmoji(score: number): string {
  if (score === 0) return "🟢";
  if (score <= 3) return "🟡";
  if (score <= 6) return "🟠";
  return "🔴";
}
