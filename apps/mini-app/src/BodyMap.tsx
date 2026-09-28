// Body map on the Progress screen (react-muscle-highlighter, MIT): anatomical front/back figures
// for the user's sex. Three modes:
//   - "Week": each region coloured by where its weekly working sets sit against MEV/MAV.
//   - a plan day: every muscle that day's exercises drive (strong) or assist (light).
//   - an exercise: its primary movers strong, its helpers light (./logic/exerciseMuscles.ts).
// The dropdown lists the plan by training day ("whole day" first, then its exercises), then recent extras.
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Plan } from "./types";
import Body, { type ExtendedBodyPart } from "react-muscle-highlighter";
import { t, type Key, type Lang } from "./i18n";
import { dayMuscles, exerciseParts, pickerGroups, PRIMARY_COLOR, regionOfMuscle, SECONDARY_COLOR, weekParts, ZONE_COLORS, type Part } from "./logic/bodyMap";
import { musclesForExercise, type ExerciseMuscles } from "./logic/exerciseMuscles";

type Volume = Array<{ group: string; sets: number; mev: number; mav: number; zone: string }>;

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

function listNames(lang: Lang, slugs: string[]): string {
  return slugs.map((s) => muscleLabel(lang, s)).join(", ");
}

type Selection = { kind: "week" } | { kind: "day"; weekday: number } | { kind: "exercise"; name: string };
const selectionValue = (s: Selection) => (s.kind === "day" ? `d:${s.weekday}` : s.kind === "exercise" ? `e:${s.name}` : "");
function parseSelection(value: string): Selection {
  if (value.startsWith("d:")) return { kind: "day", weekday: Number(value.slice(2)) };
  if (value.startsWith("e:")) return { kind: "exercise", name: value.slice(2) };
  return { kind: "week" };
}

export function BodyMap({ lang, volume, sex, exercises }: { lang: Lang; volume: Volume; sex?: "male" | "female"; exercises: string[] }) {
  const [selection, setSelection] = useState<Selection>({ kind: "week" });
  const [tapped, setTapped] = useState<string | null>(null);
  const [planDays, setPlanDays] = useState<Plan["days"]>([]);
  const colors = useMemo(themeColors, []);
  // The plan is fetched here rather than added to the dashboard: only this card needs it, and
  // it loads with the (lazy) body map. Without a plan the dropdown still lists recent exercises.
  useEffect(() => { api<Plan>("/api/v2/plan").then((plan) => setPlanDays(plan.days ?? [])).catch(() => {}); }, []);
  const groups = useMemo(() => pickerGroups(planDays, exercises), [planDays, exercises]);

  const exercise = selection.kind === "exercise" ? selection.name : null;
  const day = selection.kind === "day" ? groups.find((g) => g.weekday === selection.weekday) ?? null : null;
  const dayLabel = (group: { weekday: number | null; title: string }) =>
    group.weekday ? `${t(lang, WEEKDAY_KEYS[group.weekday])}${group.title ? ` · ${group.title}` : ""}` : t(lang, "body_map_recent_group");
  const dayData = day ? dayMuscles(day.dayNames, musclesForExercise) : null;
  const muscles: ExerciseMuscles | null = exercise ? musclesForExercise(exercise) : dayData;
  const parts: Part[] = selection.kind === "week" ? weekParts(volume) : muscles ? exerciseParts(muscles) : [];
  // Every part gets an explicit colour: the library's own assets hard-code a dark "#3f3f3f" on
  // each part, which wins over its `defaultFill`, so un-highlighted muscles ignored the theme.
  const highlighted = new Map(parts.map((p) => [p.slug as string, p.color]));
  const data: ExtendedBodyPart[] = FIGURE_PARTS.map((slug) => ({
    slug,
    color: highlighted.get(slug) ?? (slug === "hair" ? colors.border : colors.base),
  }));

  const pick = (next: Selection) => { setSelection(next); setTapped(null); };

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
    if (tapped) {
      const region = regionOfMuscle(tapped);
      const row = region ? volume.find((v) => v.group === region) : undefined;
      if (!region) return muscleLabel(lang, tapped);
      return row
        ? t(lang, "body_map_detail", { group: t(lang, `mg_${region}` as Key), n: row.sets, mev: row.mev, mav: row.mav })
        : t(lang, "body_map_untrained", { group: t(lang, `mg_${region}` as Key) });
    }
    return t(lang, "body_map_hint");
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
      <div className="body-map-figures">{figure("front")}{figure("back")}</div>
      <div className="body-map-legend">
        {selection.kind !== "week"
          ? <>
              <span><i style={{ background: PRIMARY_COLOR }} />{t(lang, "body_map_primary")}</span>
              <span><i style={{ background: SECONDARY_COLOR }} />{t(lang, "body_map_secondary")}</span>
            </>
          : (["below", "optimal", "above"] as const).map((zone) => (
              <span key={zone}><i style={{ background: ZONE_COLORS[zone] }} />{t(lang, `zone_${zone}` as Key)}</span>
            ))}
      </div>
      <p className="muted body-map-detail" aria-live="polite">{detail}</p>
    </div>
  );
}
