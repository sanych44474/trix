import { cleanAi, escapeHtml, t } from "./locales/i18n";
import type { BoardEntry } from "./domain/records";
import { e1rm } from "./domain/records";
import type { DailyCheckinDoc, ExerciseVideo, Lang, MealPlanDoc, PlanDay, PlanDoc, StrengthRecordDoc, Weekday } from "./types";
import { formatRecordBest, getPlanDay, isLowerBody, localParts, nextTarget, resolveWeightMode, type ActivityCell } from "./domain/progression";
import { normalizeVideoKey } from "./youtube";
import { phaseGuidance, phaseKey } from "./domain/mesocycle";

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
  return w;
}

// Personal streak calendar: the last N days as a 7-per-row emoji grid (💪 trained, 🍽 logged
// food only, ⬜ neither). Gamification without a leaderboard. Renders fine outside <pre>.
export function renderActivityGrid(lang: Lang, cells: ActivityCell[]): string {
  const emoji = (c: ActivityCell) => {
    if (c.workout) return "💪";
    return c.nutrition ? "🍽" : "⬜";
  };
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).map(emoji).join(""));
  return [t(lang, "activity_grid_title"), rows.join("\n"), t(lang, "activity_grid_legend")].join("\n");
}

// AI-nutritionist menu. Telegram-safe (no tables): grouped meals with item lines + a daily Σ.
export function renderMealPlan(lang: Lang, plan: MealPlanDoc): string {
  const g = lang === "en" ? "g" : "г";
  const macros = (p: number, f: number, c: number) =>
    lang === "uk" ? `Б${p}/Ж${f}/В${c}` : `P${p}/F${f}/C${c}`;
  const parts: string[] = [t(lang, "mealplan_header")];
  for (const day of plan.days) {
    if (plan.days.length > 1) parts.push(`\n<b>${escapeHtml(day.label)}</b>`);
    let dayKcal = 0;
    for (const meal of day.meals) {
      dayKcal += meal.kcal;
      parts.push(`\n🍽 <b>${escapeHtml(cleanAi(meal.name))}</b> — ${meal.kcal} kcal · ${macros(meal.protein, meal.fats, meal.carbs)}`);
      for (const it of meal.items) {
        parts.push(`   • ${escapeHtml(cleanAi(it.food))} — ${it.grams} ${g}`);
      }
    }
    parts.push(`\nΣ ${dayKcal} kcal · ${t(lang, "mealplan_target")} ${plan.targets.calories} kcal · ${macros(plan.targets.protein, plan.targets.fats, plan.targets.carbs)}`);
  }
  return parts.join("\n");
}

const WEEKDAYS: Record<Lang, Record<Weekday, string>> = {
  en: { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" },
  uk: { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Нд" },
};

export function weekdayName(lang: Lang, w: Weekday): string {
  return WEEKDAYS[lang][w];
}

// Render one leaderboard: top 10 with medals, the viewer's row flagged, and their
// own rank appended if they fall outside the top 10.
export function renderBoard(
  lang: Lang,
  title: string,
  entries: BoardEntry[],
  youId: number,
  format: (v: number) => string,
  showDetail = false,
): string {
  if (!entries.length) return `${title}\n${t(lang, "board_empty")}`;
  const name = (e: BoardEntry) => escapeHtml(e.name || t(lang, "anon"));
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
  const line = (e: BoardEntry, i: number) => {
    const you = e.userId === youId ? " 👈" : "";
    const det = showDetail && e.detail ? ` <i>${escapeHtml(e.detail)}</i>` : "";
    return `${medal(i)} ${name(e)} — ${format(e.value)}${det}${you}`;
  };
  const lines = entries.slice(0, 10).map(line);
  const yr = entries.findIndex((e) => e.userId === youId);
  if (yr >= 10) {
    lines.push("…");
    lines.push(`${yr + 1}. ${name(entries[yr])} — ${format(entries[yr].value)} 👈`);
  }
  return `${title}\n${lines.join("\n")}`;
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

// ---------- dated rolling schedule ----------

export interface SessionItem {
  date: string; // YYYY-MM-DD
  label: string; // "Пн 09.06"
  weekday: Weekday;
  day: PlanDay;
  status: "done" | "skipped" | "pending";
  isNext: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Derive the next `count` dated sessions from the plan, starting today (or tomorrow),
 * tagging each from the workout logs. `isNext` marks the earliest pending session. */
export function upcomingSessions(
  lang: Lang,
  plan: PlanDoc,
  timezone: string | undefined,
  logs: { date: string; completed: boolean }[],
  count = 6,
  fromTomorrow = false,
): SessionItem[] {
  const today = localParts(timezone).date;
  const logMap = new Map(logs.map((l) => [l.date, l.completed]));
  const start = Date.parse(today) + (fromTomorrow ? 86_400_000 : 0);
  const items: SessionItem[] = [];
  let firstPending = true;
  for (let i = 0; i < 60 && items.length < count; i++) {
    const d = new Date(start + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const w = (((d.getUTCDay() + 6) % 7) + 1) as Weekday; // Mon=1 … Sun=7
    const day = getPlanDay(plan, w);
    if (!day) continue;
    const logged = logMap.get(iso);
    const status = logged === undefined ? "pending" : logged ? "done" : "skipped";
    const isNext = status === "pending" && firstPending;
    if (status === "pending") firstPending = false;
    items.push({ date: iso, label: `${weekdayName(lang, w)} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`, weekday: w, day, status, isNext });
  }
  return items;
}

const STATUS_ICON = { done: "✅", skipped: "❌", pending: "⬜" } as const;

export function renderSchedule(lang: Lang, items: SessionItem[], videos?: Map<string, ExerciseVideo>): string {
  if (!items.length) return t(lang, "no_plan");
  const lines = [t(lang, "schedule_header"), ""];
  for (const s of items) {
    const icon = s.isNext ? "🔜" : STATUS_ICON[s.status];
    const tag = s.isNext ? ` <i>(${t(lang, "schedule_next")})</i>` : "";
    lines.push(`${icon} <b>${escapeHtml(s.label)}</b> — ${escapeHtml(s.day.muscleGroup)}${tag}`);
  }
  // Full detail for the next session.
  const next = items.find((s) => s.isNext) ?? items[0];
  if (next) {
    lines.push("", `🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>`, renderDay(lang, next.day, undefined, "brief", videos));
  }
  return lines.join("\n");
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

// Single-exercise e1RM trend (kg) over time — its own gradient line. Returns a QuickChart config
// string, or null if there are fewer than 2 weighted sessions to plot.
export function exerciseChart(lang: Lang, name: string, history: { date: string; weight: number; reps: number }[]): string | null {
  const uk = lang === "uk";
  const pts = history.filter((h) => h.weight > 0).slice(-90).map((h) => ({ x: h.date, y: Math.round(e1rm(h.weight, h.reps)) }));
  if (pts.length < 2) return null;
  const enc = (cfg: unknown) =>
    JSON.stringify(cfg).replace(/"__GRAD:([^"]+)__"/g, (_m, cols: string) =>
      `getGradientFillHelper('vertical', [${cols.split("|").map((c) => `'${c}'`).join(",")}])`,
    );
  const timeX = { type: "time", time: { unit: "week", tooltipFormat: "YYYY-MM-DD" }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } };
  return enc({
    type: "line",
    data: { datasets: [{ label: name, data: pts, type: "line", borderColor: "__GRAD:#36a2eb|#a336eb|#eb3639__", backgroundColor: "#eb3639", fill: false, lineTension: 0.3, pointRadius: 3, borderWidth: 4 }] },
    options: {
      title: { display: true, text: `${uk ? "Прогрес" : "Progress"}: ${name} (e1RM)` },
      legend: { display: false },
      scales: { xAxes: [timeX], yAxes: [{ scaleLabel: { display: true, labelString: lang === "en" ? "kg (1RM)" : "кг (1ПМ)" }, ticks: { beginAtZero: false } }] },
    },
  });
}

// Wellbeing trend (1-5) over time — energy / sleep / stress, one line each. Returns a QuickChart
// config string or null if there are fewer than 2 check-ins.
export function wellbeingChart(lang: Lang, checkins: DailyCheckinDoc[]): string | null {
  const uk = lang === "uk";
  if (checkins.length < 2) return null;
  const enc = (cfg: unknown) =>
    JSON.stringify(cfg).replace(/"__GRAD:([^"]+)__"/g, (_m, cols: string) =>
      `getGradientFillHelper('vertical', [${cols.split("|").map((c) => `'${c}'`).join(",")}])`,
    );
  const grad = (colors: string[]) => `__GRAD:${colors.join("|")}__`;
  const timeX = { type: "time", time: { unit: "week", tooltipFormat: "YYYY-MM-DD" }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } };
  const rows = checkins.slice(-90);
  const line = (label: string, sel: (c: DailyCheckinDoc) => number, colors: string[]) => ({
    label, data: rows.map((c) => ({ x: c.date, y: sel(c) })), type: "line", borderColor: grad(colors), backgroundColor: colors[colors.length - 1], fill: false, lineTension: 0.3, pointRadius: 3, borderWidth: 4,
  });
  return enc({
    type: "line",
    data: {
      datasets: [
        line(uk ? "Енергія" : "Energy", (c) => c.energy, ["#a5d6a7", "#2e7d32"]),
        line(uk ? "Сон" : "Sleep", (c) => c.sleep, ["#90caf9", "#1565c0"]),
        line(uk ? "Стрес" : "Stress", (c) => c.stress, ["#ef9a9a", "#c62828"]),
      ],
    },
    options: {
      title: { display: true, text: uk ? "Самопочуття (1–5)" : "Wellbeing (1–5)" },
      legend: { display: true, position: "top" },
      scales: { xAxes: [timeX], yAxes: [{ ticks: { beginAtZero: true, max: 5, stepSize: 1 } }] },
    },
  });
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

export function renderStrength(lang: Lang, records: StrengthRecordDoc[]): string {
  if (!records.length) return t(lang, "progress_none");
  const lines = records.map((r) => {
    // Time/distance records (planks, rowing) track a hold/distance best, not a weight target.
    if (r.metric === "time" || r.metric === "distance") {
      return `• <b>${escapeHtml(r.exercise)}</b>: ${escapeHtml(formatRecordBest(r))}`;
    }
    const lastRpe = r.history[r.history.length - 1]?.rpe;
    const target = nextTarget(r.bestWeight, r.bestReps, isLowerBody(r.exercise), lastRpe);
    const w = r.bestWeight ? `${r.bestWeight}kg` : "BW";
    return `• <b>${escapeHtml(r.exercise)}</b>: ${w} × ${r.bestReps}  →  🎯 ${escapeHtml(target)}`;
  });
  return t(lang, "progress_header") + "\n\n" + lines.join("\n");
}
