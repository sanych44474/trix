// Body map on the Progress screen (react-muscle-highlighter, MIT): anatomical front/back figures
// for the user's sex. Two modes:
//   - "Week": each region coloured by where its weekly working sets sit against MEV/MAV.
//   - an exercise: its primary movers strong, its helpers light (./logic/exerciseMuscles.ts).
// The exercise dropdown lists the plan's exercises by training day, then recent extras.
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Plan } from "./types";
import Body, { type ExtendedBodyPart } from "react-muscle-highlighter";
import { t, type Key, type Lang } from "./i18n";
import { exerciseParts, pickerGroups, PRIMARY_COLOR, regionOfMuscle, SECONDARY_COLOR, weekParts, ZONE_COLORS, type Part } from "./logic/bodyMap";
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

export function BodyMap({ lang, volume, sex, exercises }: { lang: Lang; volume: Volume; sex?: "male" | "female"; exercises: string[] }) {
  const [exercise, setExercise] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const [planDays, setPlanDays] = useState<Plan["days"]>([]);
  const colors = useMemo(themeColors, []);
  // The plan is fetched here rather than added to the dashboard: only this card needs it, and
  // it loads with the (lazy) body map. Without a plan the dropdown still lists recent exercises.
  useEffect(() => { api<Plan>("/api/v2/plan").then((plan) => setPlanDays(plan.days ?? [])).catch(() => {}); }, []);
  const groups = useMemo(() => pickerGroups(planDays, exercises), [planDays, exercises]);

  const muscles: ExerciseMuscles | null = exercise ? musclesForExercise(exercise) : null;
  const parts: Part[] = exercise ? (muscles ? exerciseParts(muscles) : []) : weekParts(volume);
  // Every part gets an explicit colour: the library's own assets hard-code a dark "#3f3f3f" on
  // each part, which wins over its `defaultFill`, so un-highlighted muscles ignored the theme.
  const highlighted = new Map(parts.map((p) => [p.slug as string, p.color]));
  const data: ExtendedBodyPart[] = FIGURE_PARTS.map((slug) => ({
    slug,
    color: highlighted.get(slug) ?? (slug === "hair" ? colors.border : colors.base),
  }));

  const pick = (name: string | null) => { setExercise(name); setTapped(null); };

  const detail = (() => {
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
        <select value={exercise ?? ""} onChange={(event) => pick(event.target.value || null)}>
          <option value="">{t(lang, "body_map_mode_week")}</option>
          {groups.map((group) => (
            <optgroup
              key={group.weekday ?? "recent"}
              label={group.weekday ? `${t(lang, WEEKDAY_KEYS[group.weekday])}${group.title ? ` · ${group.title}` : ""}` : t(lang, "body_map_recent_group")}
            >
              {group.names.map((name) => <option key={name} value={name}>{name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="body-map-figures">{figure("front")}{figure("back")}</div>
      <div className="body-map-legend">
        {exercise
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
