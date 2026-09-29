// Body map on the Progress screen (react-muscle-highlighter, MIT): anatomical front/back figures
// for the user's sex. Four modes:
//   - "Week": each muscle coloured by its fractional weekly sets (primary 1, assisting ½) against
//     its own MEV/MAV; tapping one lists the exercises and sets behind it.
//   - "Recovery": each muscle by days since it was last loaded (red / yellow / green).
//   - a plan day: every muscle that day's exercises drive (strong) or assist (light).
//   - an exercise: its primary movers strong, its helpers light (./logic/exerciseMuscles.ts).
// The dropdown lists the plan by training day ("whole day" first, then its exercises), then recent extras.
import { useEffect, useMemo, useRef, useState } from "react";
import { shareBodyMapStory } from "./storyCard";
import { canShareStory } from "./telegram";
import { api } from "./api";
import type { Plan } from "./types";
import Body, { type ExtendedBodyPart } from "react-muscle-highlighter";
import { t, type Key, type Lang } from "./i18n";
import { dayMuscles, exerciseParts, muscleWeekParts, pickerGroups, PRIMARY_COLOR, RECOVERY_COLORS, recoveryParts, SECONDARY_COLOR, ZONE_COLORS, type Part } from "./logic/bodyMap";
import { lopsidedPairs, muscleRecovery, weeklyMuscleSets, type LoggedDay } from "./logic/muscleLoad";
import { weeklyReport } from "./logic/weeklyReport";
import { musclesForExercise, type ExerciseMuscles } from "./logic/exerciseMuscles";


// The figure takes plain colours (SVG attributes, where CSS variables don't resolve), so the
// theme's base/outline colours are read once from the page.
function themeColors(): { base: string; border: string } {
  const css = getComputedStyle(document.documentElement);
  return {
    base: css.getPropertyValue("--body-map-base").trim() || "#2a3140",
    border: css.getPropertyValue("--body-map-border").trim() || "#3b4456",
  };
}

// Everything the figure draws (react-muscle-highlighter's Slug list).
const FIGURE_PARTS = [
  "abs", "adductors", "ankles", "biceps", "calves", "chest", "deltoids", "feet", "forearm", "gluteal", "hamstring",
  "hands", "hair", "head", "knees", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius", "triceps", "upper-back",
] as const;
const MUSCLES = new Set(["abs", "adductors", "biceps", "calves", "chest", "deltoids", "forearm", "gluteal", "hamstring", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius", "triceps", "upper-back"]);
const WEEKDAY_KEYS: Record<number, Key> = { 1: "weekday_mon", 2: "weekday_tue", 3: "weekday_wed", 4: "weekday_thu", 5: "weekday_fri", 6: "weekday_sat", 7: "weekday_sun" };
const muscleLabel = (lang: Lang, slug: string) => t(lang, `muscle_${slug.replace("-", "_")}` as Key);

function daysAgoLabel(lang: Lang, days: number): string {
  return days === 0 ? t(lang, "days_ago_0") : days === 1 ? t(lang, "days_ago_1") : t(lang, "days_ago_n", { n: days });
}

function listNames(lang: Lang, slugs: string[]): string {
  return slugs.map((s) => muscleLabel(lang, s)).join(", ");
}

type Selection = { kind: "week" } | { kind: "recovery" } | { kind: "day"; weekday: number } | { kind: "exercise"; name: string };
const selectionValue = (s: Selection) => (s.kind === "day" ? `d:${s.weekday}` : s.kind === "exercise" ? `e:${s.name}` : s.kind === "recovery" ? "r" : "");
function parseSelection(value: string): Selection {
  if (value === "r") return { kind: "recovery" };
  if (value.startsWith("d:")) return { kind: "day", weekday: Number(value.slice(2)) };
  if (value.startsWith("e:")) return { kind: "exercise", name: value.slice(2) };
  return { kind: "week" };
}

function isoDaysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function BodyMap({ lang, logs, today, sex, exercises }: { lang: Lang; logs: LoggedDay[]; today: string; sex?: "male" | "female"; exercises: string[] }) {
  const [selection, setSelection] = useState<Selection>({ kind: "week" });
  const [tapped, setTapped] = useState<string | null>(null);
  const [planDays, setPlanDays] = useState<Plan["days"]>([]);
  const colors = useMemo(themeColors, []);
  // The plan is fetched here rather than added to the dashboard: only this card needs it, and
  // it loads with the (lazy) body map. Without a plan the dropdown still lists recent exercises.
  useEffect(() => { api<Plan>("/api/v2/plan").then((plan) => setPlanDays(plan.days ?? [])).catch(() => {}); }, []);
  const groups = useMemo(() => pickerGroups(planDays, exercises), [planDays, exercises]);
  // Same 7-day window as the dashboard's weekly volume (today and the six days before).
  const week = useMemo(() => weeklyMuscleSets(logs, isoDaysBefore(today, 6), musclesForExercise), [logs, today]);
  const recovery = useMemo(() => muscleRecovery(logs, today, musclesForExercise), [logs, today]);
  const balance = useMemo(() => weeklyReport(logs, isoDaysBefore(today, 6), musclesForExercise), [logs, today]);
  const num = (n: number) => (lang === "uk" ? String(n).replace(".", ",") : String(n));

  const exercise = selection.kind === "exercise" ? selection.name : null;
  const day = selection.kind === "day" ? groups.find((g) => g.weekday === selection.weekday) ?? null : null;
  const dayLabel = (group: { weekday: number | null; title: string }) =>
    group.weekday ? `${t(lang, WEEKDAY_KEYS[group.weekday])}${group.title ? ` · ${group.title}` : ""}` : t(lang, "body_map_recent_group");
  const dayData = day ? dayMuscles(day.dayNames, musclesForExercise) : null;
  const muscles: ExerciseMuscles | null = exercise ? musclesForExercise(exercise) : dayData;
  const parts: Part[] = selection.kind === "week" ? muscleWeekParts(week)
    : selection.kind === "recovery" ? recoveryParts(recovery)
      : muscles ? exerciseParts(muscles) : [];
  // Every part gets an explicit colour: the library's own assets hard-code a dark "#3f3f3f" on
  // each part, which wins over its `defaultFill`, so un-highlighted muscles ignored the theme.
  const highlighted = new Map(parts.map((p) => [p.slug as string, p.color]));
  const data: ExtendedBodyPart[] = FIGURE_PARTS.map((slug) => ({
    slug,
    color: highlighted.get(slug) ?? (slug === "hair" ? colors.border : colors.base),
  }));

  const pick = (next: Selection) => { setSelection(next); setTapped(null); };

  // Week and recovery views can go to a Telegram story: the figures as drawn, plus three lines.
  const figuresRef = useRef<HTMLDivElement>(null);
  const [storyState, setStoryState] = useState<"idle" | "busy" | "failed">("idle");
  const storyable = canShareStory() && (selection.kind === "week" || selection.kind === "recovery");
  const shareStory = async () => {
    const svgs = [...(figuresRef.current?.querySelectorAll("svg") ?? [])] as SVGSVGElement[];
    if (!svgs.length) return;
    const lines = selection.kind === "recovery"
      ? [
          ...(recovery.some((m) => m.status === "recovering") ? [t(lang, "recovery_summary_tired", { list: listNames(lang, recovery.filter((m) => m.status === "recovering").map((m) => m.slug)) })] : []),
          t(lang, "story_ready_line", { list: listNames(lang, recovery.filter((m) => m.status === "ready" && m.daysAgo !== null).map((m) => m.slug).slice(0, 5)) || "—" }),
        ]
      : [...week].filter((m) => m.sets > 0).sort((a, b) => b.sets - a.sets).slice(0, 3)
          .map((m) => t(lang, "story_muscle_line", { muscle: muscleLabel(lang, m.slug), n: num(m.sets) }));
    setStoryState("busy");
    try {
      await shareBodyMapStory({
        eyebrow: `${isoDaysBefore(today, 6).slice(5)} → ${today.slice(5)}`,
        title: t(lang, selection.kind === "recovery" ? "story_recovery_title" : "story_bodymap_title"),
        footer: t(lang, "story_footer"),
      }, svgs, lines);
      setStoryState("idle");
    } catch {
      setStoryState("failed");
    }
  };

  const detail = (() => {
    if (day && dayData) {
      if (tapped) {
        // Which of the day's exercises drive / assist the tapped muscle.
        const by = (role: "primary" | "secondary") => day.dayNames.filter((n) => (musclesForExercise(n)?.[role] ?? []).includes(tapped as never));
        const drive = by("primary");
        const assist = by("secondary").filter((n) => !drive.includes(n));
        if (!drive.length && !assist.length) return `${muscleLabel(lang, tapped)} — ${t(lang, "body_map_role_none")}`;
        return `${muscleLabel(lang, tapped)}: ${[
          drive.length ? t(lang, "body_map_day_drives", { names: drive.join(", ") }) : "",
          assist.length ? t(lang, "body_map_day_assists", { names: assist.join(", ") }) : "",
        ].filter(Boolean).join("; ")}.`;
      }
      const head = t(lang, "body_map_day_detail", { day: dayLabel(day), n: day.dayNames.length });
      const body = !dayData.primary.length ? "" : dayData.secondary.length
        ? t(lang, "body_map_exercise_detail", { primary: listNames(lang, dayData.primary), secondary: listNames(lang, dayData.secondary) })
        : t(lang, "body_map_exercise_primary_only", { primary: listNames(lang, dayData.primary) });
      const unknown = dayData.unknown.length ? t(lang, "body_map_day_unknown", { names: dayData.unknown.join(", ") }) : "";
      return [head, body, unknown].filter(Boolean).join(" ");
    }
    if (exercise) {
      if (!muscles) return t(lang, "body_map_unknown_exercise", { name: exercise });
      if (tapped) {
        const role = muscles.primary.includes(tapped as never) ? "body_map_role_primary" : muscles.secondary.includes(tapped as never) ? "body_map_role_secondary" : "body_map_role_none";
        return `${muscleLabel(lang, tapped)} — ${t(lang, role as Key)}`;
      }
      return muscles.secondary.length
        ? t(lang, "body_map_exercise_detail", { primary: listNames(lang, muscles.primary), secondary: listNames(lang, muscles.secondary) })
        : t(lang, "body_map_exercise_primary_only", { primary: listNames(lang, muscles.primary) });
    }
    if (selection.kind === "recovery") {
      if (tapped) {
        const m = recovery.find((r) => r.slug === tapped);
        if (!m) return muscleLabel(lang, tapped);
        const status = t(lang, `recovery_${m.status}` as Key);
        if (m.daysAgo === null) return t(lang, "recovery_detail_none", { muscle: muscleLabel(lang, tapped) });
        return t(lang, m.role === "primary" ? "recovery_detail_primary" : "recovery_detail_secondary", {
          muscle: muscleLabel(lang, tapped), when: daysAgoLabel(lang, m.daysAgo), exercises: m.exercises.join(", "), status,
        });
      }
      const tired = recovery.filter((m) => m.status === "recovering").map((m) => m.slug);
      const almost = recovery.filter((m) => m.status === "almost").map((m) => m.slug);
      if (!tired.length && !almost.length) return t(lang, "recovery_all_ready");
      return [
        tired.length ? t(lang, "recovery_summary_tired", { list: listNames(lang, tired) }) : "",
        almost.length ? t(lang, "recovery_summary_almost", { list: listNames(lang, almost) }) : "",
      ].filter(Boolean).join(" ");
    }
    if (tapped) {
      const m = week.find((w) => w.slug === tapped);
      if (!m) return muscleLabel(lang, tapped);
      if (!m.sets) return t(lang, "week_muscle_none", { muscle: muscleLabel(lang, tapped) });
      const list = m.exercises.map((e) => `${e.name} ×${e.sets}${e.role === "secondary" ? ` (${t(lang, "week_muscle_assist_short")})` : ""}`).join(", ");
      return t(lang, m.mev > 0 ? "week_muscle_detail" : "week_muscle_detail_nomev", { muscle: muscleLabel(lang, tapped), n: num(m.sets), mev: m.mev, mav: m.mav, list });
    }
    const lopsided = lopsidedPairs((slug) => week.find((w) => w.slug === slug)?.sets ?? 0);
    // The week's balance score (same as the Sunday digest) leads whenever there's anything logged.
    const score = balance.trainedSets > 0 ? t(lang, "week_balance_score", { score: balance.balance }) + " " : "";
    if (lopsided.length) {
      return score + lopsided.map((p) => t(lang, "week_lopsided", { weak: muscleLabel(lang, p.weak), weakSets: num(p.weakSets), strong: muscleLabel(lang, p.strong), strongSets: num(p.strongSets) })).join(" ");
    }
    return score + t(lang, "body_map_hint");
  })();

  const figure = (side: "front" | "back") => (
    <figure>
      <Body
        data={data}
        side={side}
        gender={sex ?? "male"}
        scale={1}
        border={colors.border}
        defaultFill={colors.base}
        onBodyPartPress={(part) => { if (part.slug && MUSCLES.has(part.slug)) setTapped(part.slug); }}
      />
      <figcaption>{t(lang, side === "front" ? "body_map_front" : "body_map_back")}</figcaption>
    </figure>
  );

  return (
    <div className="body-map">
      <label className="body-map-select">
        <span>{t(lang, "body_map_pick_label")}</span>
        <select value={selectionValue(selection)} onChange={(event) => pick(parseSelection(event.target.value))}>
          <option value="">{t(lang, "body_map_mode_week")}</option>
          <option value="r">{t(lang, "body_map_mode_recovery")}</option>
          {groups.map((group) => (
            <optgroup key={group.weekday ?? "recent"} label={dayLabel(group)}>
              {group.weekday !== null && (
                <option value={selectionValue({ kind: "day", weekday: group.weekday })}>
                  {t(lang, "body_map_whole_day", { day: dayLabel(group) })}
                </option>
              )}
              {group.names.map((name) => <option key={name} value={selectionValue({ kind: "exercise", name })}>{name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="body-map-figures" ref={figuresRef}>{figure("front")}{figure("back")}</div>
      <div className="body-map-legend">
        {selection.kind === "recovery"
          ? (["recovering", "almost", "ready"] as const).map((status) => (
              <span key={status}><i style={{ background: RECOVERY_COLORS[status] }} />{t(lang, `recovery_legend_${status}` as Key)}</span>
            ))
          : selection.kind !== "week"
          ? <>
              <span><i style={{ background: PRIMARY_COLOR }} />{t(lang, "body_map_primary")}</span>
              <span><i style={{ background: SECONDARY_COLOR }} />{t(lang, "body_map_secondary")}</span>
            </>
          : (["below", "optimal", "above"] as const).map((zone) => (
              <span key={zone}><i style={{ background: ZONE_COLORS[zone] }} />{t(lang, `zone_${zone}` as Key)}</span>
            ))}
      </div>
      <p className="muted body-map-detail" aria-live="polite">{detail}</p>
      {storyable && (
        <button className="button button-ghost" disabled={storyState === "busy"} onClick={() => void shareStory()}>
          {storyState === "busy" ? t(lang, "saving_ellipsis") : storyState === "failed" ? t(lang, "share_story_failed") : t(lang, "share_story_btn")}
        </button>
      )}
    </div>
  );
}
