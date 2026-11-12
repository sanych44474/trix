import { cleanAi, escapeHtml, t } from "./locales/i18n";
import type { ExerciseVideo, Lang, PlanDay, PlanDoc, Weekday } from "./types";
import { resolveWeightMode } from "./domain/exerciseClass";
import { normalizeVideoKey } from "./youtube";
import { phaseGuidance, phaseKey } from "./domain/mesocycle";
import { GROCERY_ORDER, formatGrams, type GroceryCategory, type GroceryLine } from "./domain/groceryList";
import type { ConditioningWeek } from "./domain/conditioning";
import { planBalance } from "./domain/muscleLoad";
import type { WeeklyReport } from "./domain/weeklyReport";
import type { Quest } from "./domain/quests";
import { isSelfSelectWeight } from "./domain/startWeights";
import { challengeTitleParts, type ChallengeTemplate } from "./domain/challenges";
import { QUEST_XP } from "./domain/gamification";

/** Human-readable weekly conditioning load: "3 cardio sessions - ~180 min", or the session count
 * alone when nothing carried a duration (a distance-only log has real work the minutes can't see,
 * and "~0 min" would read as a bug). */
export function conditioningLoadLabel(lang: Lang, week: ConditioningWeek): string {
  const vars = { sessions: week.sessions, minutes: week.minutes };
  return t(lang, week.minutes > 0 ? "cond_load_min" : "cond_load_sessions", vars);
}

const GROCERY_CATEGORY_KEY: Record<GroceryCategory, "gro_produce" | "gro_protein" | "gro_dairy" | "gro_grains" | "gro_pantry" | "gro_other"> = {
  produce: "gro_produce", protein: "gro_protein", dairy: "gro_dairy",
  grains: "gro_grains", pantry: "gro_pantry", other: "gro_other",
};

/** Cache key for an exercise's technique video — canonical English name preferred. */
export function exerciseVideoKey(ex: { name: string; canonicalName?: string }): string {
  return normalizeVideoKey(ex.canonicalName || ex.name);
}

// API-Ninjas muscle enums → Ukrainian. The "muscles" field is English-canonical and isn't always
// run through the bulk translator (e.g. catalog-grounded swaps store the raw enum), so leaks like
// "hamstrings" showed up in UA plans — localize at render time.
const MUSCLE_UA: Record<string, string> = {
  // chest
  chest: "грудні м'язи",
  // back
  lats: "найширші м'язи спини", latissimus: "найширші м'язи спини", "latissimus dorsi": "найширші м'язи спини",
  traps: "трапецієподібні м'язи", trapezius: "трапецієподібні м'язи",
  rhomboids: "ромбоподібні м'язи",
  "middle back": "ромбоподібні м'язи", "upper back": "верхня частина спини",
  "lower back": "розгиначі спини", "erector spinae": "розгиначі спини",
  // shoulders
  shoulders: "дельтоподібні м'язи", deltoids: "дельтоподібні м'язи",
  "front delts": "передні дельти", "rear delts": "задні дельти", "side delts": "середні дельти",
  // arms
  biceps: "біцепс", triceps: "трицепс", forearms: "передпліччя",
  // core / abs
  abs: "прес", abdominals: "прес", core: "кор", "obliques": "косі м'язи живота",
  // legs
  quadriceps: "квадрицепс", quads: "квадрицепс",
  hamstrings: "біцепс стегна",
  glutes: "сідничні м'язи",
  calves: "литкові м'язи",
  adductors: "привідні м'язи стегна", abductors: "відвідні м'язи стегна",
  // other
  neck: "м'язи шиї", "hip flexors": "згиначі стегна",
};

/** Localize a comma-separated muscles string for UA; leaves already-translated tokens untouched. */
function localizeMuscles(s: string, lang: Lang): string {
  if (lang !== "uk") return s;
  return s
    .split(",")
    .map((part) => {
      const key = part.trim().toLowerCase().replace(/_/g, " ");
      return MUSCLE_UA[key] ?? part.trim();
    })
    .filter(Boolean)
    .join(", ");
}

// Bodyweight / unset loads render as a bare "—" which looks broken next to the sets. Show a clean
// label instead, and drop the "· weight" segment entirely when there's nothing meaningful.
function startWeightLabel(raw: string, lang: Lang): string {
  const w = (raw || "").trim();
  if (!w || w === "—" || w === "-") return "";
  if (/^(bodyweight|власна вага|своя вага)$/i.test(w)) return lang === "uk" ? "власна вага" : "bodyweight";
  // "pick a weight" (domain/startWeights.ts): say how to pick it, right where the number would be.
  if (isSelfSelectWeight(w)) return lang === "uk" ? "вагу підбери: 2–3 повтори в запасі" : "pick a weight: 2–3 reps in reserve";
  return w;
}

// AI-nutritionist menu. Telegram-safe (no tables): grouped meals with item lines + a daily Σ.
/** Aisle-ordered shopping list for `days` days of the current menu. Rendered as a tick-list so
 * it can be worked through in the shop; amounts are already rounded to buyable sizes. */
export function renderGroceryList(lang: Lang, lines: GroceryLine[], days: number): string {
  const g = lang === "en" ? "g" : "г";
  const amount = (grams: number) => (grams >= 1000 ? formatGrams(grams) : `${grams} ${g}`);
  const parts: string[] = [t(lang, "grocery_header", { days }), ""];
  for (const category of GROCERY_ORDER) {
    const rows = lines.filter((l) => l.category === category);
    if (!rows.length) continue;
    parts.push(`<b>${t(lang, GROCERY_CATEGORY_KEY[category])}</b>`);
    for (const r of rows) parts.push(`☐ ${escapeHtml(cleanAi(r.food))} — ${amount(r.grams)}`);
    parts.push("");
  }
  parts.push(t(lang, "grocery_footer"));
  return parts.join("\n");
}

const WEEKDAYS: Record<Lang, Record<Weekday, string>> = {
  en: { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" },
  uk: { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Нд" },
};

export function weekdayName(lang: Lang, w: Weekday): string {
  return WEEKDAYS[lang][w];
}

export function renderDay(
  _lang: Lang,
  day: PlanDay,
  descs?: Map<string, string>,
  tech: "full" | "brief" | "none" = "full",
  videos?: Map<string, ExerciseVideo>,
): string {
  // Count how many exercises share each supersetGroup so 3+ read as a circuit and 2 as a
  // superset. Without this the plan looks like straight sets — the user can't tell whether
  // "A" means "do this then rest" or "do this back-to-back with the next A".
  const groupSize = new Map<string, number>();
  for (const ex of day.exercises) if (ex.supersetGroup) groupSize.set(ex.supersetGroup, (groupSize.get(ex.supersetGroup) ?? 0) + 1);
  const lines = day.exercises.map((ex, i) => {
    // Same-group members share an indent + tag; a group with 3+ exercises renders as a "circuit"
    // (mini-round) instead of a two-exercise "superset". Telegram has no tables, so the visual
    // grouping is emoji + indent + explicit label per row.
    const g = ex.supersetGroup;
    const gsize = g ? groupSize.get(g) ?? 0 : 0;
    const ssTag = g
      ? gsize >= 3
        ? `🔁 ${_lang === "uk" ? "коло" : "circuit"} ${escapeHtml(g)} `
        : `🔗 ${_lang === "uk" ? "суперсет" : "superset"} ${escapeHtml(g)} `
      : "";
    const indent = g ? "   " : "";
    const wLabel = startWeightLabel(cleanAi(ex.startWeight), _lang);
    // Clarify unilateral / per-dumbbell loads so "60" doesn't read as a bilateral number.
    const wm = resolveWeightMode(ex.name, ex.weightMode);
    const wmLabel = wm === "perSide" ? ` (${t(_lang, "wmode_perside")})` : wm === "perHand" ? ` (${t(_lang, "wmode_perhand")})` : "";
    let s = `${indent}${i + 1}. ${ssTag}<b>${escapeHtml(cleanAi(ex.name))}</b> — ${escapeHtml(cleanAi(ex.sets))}${wLabel ? ` · ${escapeHtml(wLabel)}${wmLabel}` : ""}`;
    // Compact professional meta (role/RPE/RIR/rest/tempo/HR-zone) — short universal tokens.
    const meta = [
      ex.role ? (ex.role === "primary" ? (_lang === "uk" ? "основна" : "primary") : (_lang === "uk" ? "допоміжна" : "accessory")) : "",
      ex.rpe ? `RPE ${cleanAi(ex.rpe)}` : "",
      ex.rir ? `RIR ${cleanAi(ex.rir)}` : "",
      ex.rest ? `⏱ ${cleanAi(ex.rest)}` : "",
      ex.tempo ? `${_lang === "uk" ? "темп" : "tempo"} ${cleanAi(ex.tempo)}` : "",
      ex.heartRateZone ? `❤️ ${cleanAi(ex.heartRateZone)}` : "",
    ].filter(Boolean);
    if (meta.length) s += `\n   ${indent}<i>${escapeHtml(meta.join(" · "))}</i>`;
    if (ex.warmupScheme) {
      s += `\n   ${indent}<i>${_lang === "uk" ? "розминка" : "warm-up"}: ${escapeHtml(cleanAi(ex.warmupScheme))}</i>`;
    }
    if (tech !== "none" && ex.technique) {
      const technique =
        tech === "brief"
          ? cleanAi(ex.technique).split(/[.!?]/)[0].trim() + "."
          : cleanAi(ex.technique);
      s += `\n   ${indent}<i>${escapeHtml(technique)}</i>`;
    }
    if (ex.muscles) s += `\n   ${indent}${escapeHtml(localizeMuscles(cleanAi(ex.muscles), _lang))}`;
    const desc = ex.exerciseId ? descs?.get(ex.exerciseId) : undefined;
    if (desc) s += `\n   ${indent}📖 <i>${escapeHtml(desc)}</i>`;
    const video = videos?.get(exerciseVideoKey(ex));
    if (video?.url) {
      s += `\n   ${indent}🎥 <a href="${escapeHtml(video.url)}">${t(_lang, "video_label")}</a>`;
    }
    return s;
  });
  const block: string[] = [];
  if (day.warmUp?.length) {
    block.push(`🔥 <i>${escapeHtml(cleanAi(day.warmUp.join(" · ")))}</i>`);
  }
  block.push(lines.join("\n"));
  if (day.coolDown?.length) {
    block.push(`🧘 <i>${escapeHtml(cleanAi(day.coolDown.join(" · ")))}</i>`);
  }
  return block.join("\n");
}

const SESSION_TYPE_UK: Record<string, string> = {
  strength: "силова",
  hypertrophy: "гіпертрофія",
  conditioning: "кардіо",
  mobility: "рухливість",
  hybrid: "гібрид",
  "active-recovery": "активне відновлення",
};
const SESSION_TYPE_EN: Record<string, string> = {
  strength: "strength",
  hypertrophy: "hypertrophy",
  conditioning: "conditioning",
  mobility: "mobility",
  hybrid: "hybrid",
  "active-recovery": "active recovery",
};

function localizeSessionType(lang: Lang, raw: string): string {
  const key = raw.toLowerCase().trim();
  const map = lang === "uk" ? SESSION_TYPE_UK : SESSION_TYPE_EN;
  return map[key] ?? raw;
}

// Optional session-type + duration meta line for a day, e.g. "🏷 силова · ⏳ ~45 хв".
function dayMeta(lang: Lang, day: PlanDay): string {
  const bits = [
    day.sessionType ? `🏷 ${escapeHtml(localizeSessionType(lang, cleanAi(day.sessionType)))}` : "",
    typeof day.durationMin === "number" ? `⏳ ~${day.durationMin} ${lang === "uk" ? "хв" : "min"}` : "",
  ].filter(Boolean);
  return bits.length ? `<i>${bits.join(" · ")}</i>\n` : "";
}

export function renderToday(
  lang: Lang,
  day: PlanDay,
  dateLabel?: string,
  descs?: Map<string, string>,
  videos?: Map<string, ExerciseVideo>,
  opts?: { noCta?: boolean }, // noCta: rendering a plan for EDITING, not logging — hide the "record workout" call-to-action
): string {
  const header = dateLabel
    ? `🏋️ <b>${escapeHtml(dateLabel)} — ${escapeHtml(day.muscleGroup)}</b>`
    : t(lang, "today_header", { group: day.muscleGroup });
  const body = `${header}\n${dayMeta(lang, day)}\n${renderDay(lang, day, descs, "full", videos)}`;
  return opts?.noCta ? body : `${body}\n\n${t(lang, "log_cta")}`;
}

/** The weekly digest's muscle lines (domain/weeklyReport.ts): balance score, what lagged, records,
 *  one focus for next week and any badges the week just earned. */
export function renderWeeklyMuscleLines(lang: Lang, r: WeeklyReport, prs: number, newBadges: string[]): string[] {
  const muscle = (slug: string) => t(lang, `mus_${slug.replace("-", "_")}` as Parameters<typeof t>[1]);
  const num = (n: number) => (lang === "uk" ? String(Math.round(n * 2) / 2).replace(".", ",") : String(Math.round(n * 2) / 2));
  const lines = [t(lang, "wreport_balance", { score: r.balance })];
  if (r.lagging.length) {
    lines.push(t(lang, "wreport_lagging", { list: r.lagging.map((l) => `${muscle(l.slug)} (${num(l.sets)}/${l.mev})`).join(", ") }));
  }
  if (prs > 0) lines.push(t(lang, "wreport_prs", { n: prs }));
  lines.push(r.focus
    ? t(lang, "wreport_focus", { muscle: muscle(r.focus.slug), exercise: r.focus.exercise[lang] })
    : t(lang, "wreport_focus_keep"));
  if (newBadges.length) lines.push(t(lang, "wreport_badges", { list: newBadges.map((c) => t(lang, `badge_${c}` as Parameters<typeof t>[1])).join(", ") }));
  return lines;
}

/** A challenge's display title without its emoji (seasonal ones name their month). */
export function challengeTitleText(lang: Lang, tpl: ChallengeTemplate): string {
  const { key, vars } = challengeTitleParts(tpl);
  const month = typeof vars.month === "number" ? t(lang, "wa_d_months").split(",")[vars.month - 1] ?? "" : undefined;
  return t(lang, key as Parameters<typeof t>[1], { ...vars, ...(month !== undefined ? { month } : {}) });
}

/** Next week's quests for the Sunday digest (domain/quests.ts), as "• …" lines under a header. */
export function renderQuestLines(lang: Lang, quests: Quest[]): string[] {
  if (!quests.length) return [];
  return [t(lang, "wreport_quests", { xp: QUEST_XP }), ...quests.map((q) => `• ${questLabel(lang, q)}`)];
}

/** One quest as the user reads it ("Hamstrings: 6 sets this week"), HTML-escaped. */
export function questLabel(lang: Lang, q: Pick<Quest, "kind" | "target" | "muscle">): string {
  return q.kind === "muscle_sets"
    ? t(lang, "quest_muscle_sets", { n: q.target, muscle: capitalize(t(lang, `mus_${(q.muscle ?? "").replace("-", "_")}` as Parameters<typeof t>[1])) })
    : t(lang, `quest_${q.kind}` as Parameters<typeof t>[1], { n: q.target });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The plan-balance note (domain/muscleLoad.ts planBalance), or "" when the plan is balanced. */
export function renderPlanBalance(lang: Lang, split: PlanDay[]): string {
  const issues = planBalance(split);
  if (!issues.length) return "";
  const muscle = (slug: string) => t(lang, `bal_m_${slug.replace("-", "_")}` as Parameters<typeof t>[1]);
  const lines = issues.map((issue) => {
    const s = issue.suggestion;
    const day = s ? weekdayName(lang, s.weekday as Weekday) : "";
    const exercise = s ? s[lang] : "";
    if (issue.kind === "imbalance" && issue.other && s) {
      const name = muscle(issue.slug);
      const num = (n: number) => (lang === "uk" ? String(n).replace(".", ",") : String(n));
      return t(lang, "plan_balance_imbalance", { muscle: name.charAt(0).toUpperCase() + name.slice(1), weak: num(issue.sets), strong: num(issue.other.sets), other: muscle(issue.other.slug), exercise, day });
    }
    return s
      ? t(lang, "plan_balance_missing", { muscle: muscle(issue.slug), exercise, day })
      : t(lang, "plan_balance_missing_nosuggest", { muscle: muscle(issue.slug) });
  });
  return [t(lang, "plan_balance_header"), ...lines].join("\n");
}

export function renderPlan(lang: Lang, plan: PlanDoc, videos?: Map<string, ExerciseVideo>): string {
  const parts: string[] = [t(lang, "plan_header"), ""];
  if (plan.mesocycle) {
    const g = phaseGuidance(plan.mesocycle.phase);
    parts.push(
      `${g.emoji} <b>${t(lang, phaseKey(plan.mesocycle.phase) as Parameters<typeof t>[1])}</b> · ` +
        `${t(lang, "meso_week", { n: plan.mesocycle.weekInBlock, total: plan.mesocycle.phase === "deload" ? 1 : plan.mesocycle.blockLength })} · ${g.reps} · ${g.intensity}`,
      "",
    );
  }

  for (const day of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    const meta = dayMeta(lang, day);
    parts.push(
      `🗓️ <b>${weekdayName(lang, day.weekday)} — ${escapeHtml(day.muscleGroup)}</b>${meta ? "\n" + meta.trimEnd() : ""}`,
    );
    parts.push(renderDay(lang, day, undefined, "none", videos));
    parts.push("");
  }

  if (typeof plan.stepsTarget === "number") {
    parts.push(`🚶 ${plan.stepsTarget} ${lang === "uk" ? "кроків/день" : "steps/day"}`, "");
  }

  if (plan.movementAudit) {
    parts.push(`🧭 <i>${escapeHtml(cleanAi(plan.movementAudit))}</i>`, "");
  }

  const balance = renderPlanBalance(lang, plan.split);
  if (balance) parts.push(balance, "");

  const n = plan.nutrition;
  parts.push(t(lang, "nutrition_block"));
  const macroLine = (m: { calories: number; protein: number; fats: number; carbs: number }) =>
    `🔥 ${m.calories} kcal · 🥩 ${m.protein}g · 🥑 ${m.fats}g · 🍚 ${m.carbs}g`;
  const r = plan.restDayNutrition;
  if (r) {
    parts.push(`${t(lang, "kbju_training_day")} ${macroLine(n)}`);
    parts.push(`${t(lang, "kbju_rest_day")} ${macroLine(r)}`);
  } else {
    parts.push(macroLine(n));
  }
  if (n.notes) parts.push(`<i>${escapeHtml(n.notes)}</i>`);
  parts.push("");

  parts.push(t(lang, "methodology_block"));
  parts.push(`<i>${escapeHtml(plan.methodology)}</i>`);

  return parts.join("\n");
}

// Split a long report into Telegram-safe chunks (<= limit) on blank-line section boundaries, so a
// monospace <pre> table is never cut mid-block (which would break HTML parsing). The owner report
// grew past Telegram's 4096-char single-message cap; this sends it as a few clean messages.
export function chunkReport(text: string, limit = 3800): string[] {
  const sections = text.split(/\n{2,}/).filter((s) => s.trim().length > 0);
  const chunks: string[] = [];
  let buf = "";
  for (const sec of sections) {
    if (buf && buf.length + 2 + sec.length > limit) {
      chunks.push(buf);
      buf = sec;
    } else {
      buf = buf ? `${buf}\n\n${sec}` : sec;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
