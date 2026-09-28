// Body map on the Progress screen (react-muscle-highlighter, MIT): anatomical front/back figures
// for the user's sex. Two modes:
//   - "Week": each region coloured by where its weekly working sets sit against MEV/MAV.
//   - an exercise: its primary movers strong, its helpers light (./logic/exerciseMuscles.ts).
// The exercise list is what the user actually logged recently; any other name can be typed.
import { useId, useMemo, useState } from "react";
import Body, { type ExtendedBodyPart } from "react-muscle-highlighter";
import { t, type Key, type Lang } from "./i18n";
import { exerciseParts, PRIMARY_COLOR, regionOfMuscle, SECONDARY_COLOR, weekParts, ZONE_COLORS, type Part } from "./logic/bodyMap";
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
const muscleLabel = (lang: Lang, slug: string) => t(lang, `muscle_${slug.replace("-", "_")}` as Key);

function listNames(lang: Lang, slugs: string[]): string {
  return slugs.map((s) => muscleLabel(lang, s)).join(", ");
}

export function BodyMap({ lang, volume, sex, exercises }: { lang: Lang; volume: Volume; sex?: "male" | "female"; exercises: string[] }) {
  const [exercise, setExercise] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tapped, setTapped] = useState<string | null>(null);
  const listId = useId();
  const colors = useMemo(themeColors, []);

  const muscles: ExerciseMuscles | null = exercise ? musclesForExercise(exercise) : null;
  const parts: Part[] = exercise ? (muscles ? exerciseParts(muscles) : []) : weekParts(volume);
  // Every part gets an explicit colour: the library's own assets hard-code a dark "#3f3f3f" on
  // each part, which wins over its `defaultFill`, so un-highlighted muscles ignored the theme.
  const highlighted = new Map(parts.map((p) => [p.slug as string, p.color]));
  const data: ExtendedBodyPart[] = FIGURE_PARTS.map((slug) => ({
    slug,
    color: highlighted.get(slug) ?? (slug === "hair" ? colors.border : colors.base),
  }));

  const pick = (name: string | null) => { setExercise(name); setTapped(null); if (name === null) setQuery(""); };
  const onSearch = (value: string) => { setQuery(value); setTapped(null); setExercise(value.trim().length >= 3 ? value.trim() : null); };

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
      <div className="body-map-picker">
        <button type="button" className={exercise === null ? "rest-chip selected" : "rest-chip"} onClick={() => pick(null)}>{t(lang, "body_map_mode_week")}</button>
        {exercises.map((name) => (
          <button type="button" key={name} className={exercise === name ? "rest-chip selected" : "rest-chip"} onClick={() => { setQuery(""); pick(name); }}>{name}</button>
        ))}
      </div>
      <input
        className="body-map-search"
        type="search"
        list={listId}
        value={query}
        placeholder={t(lang, "body_map_search_ph")}
        onChange={(event) => onSearch(event.target.value)}
      />
      <datalist id={listId}>{exercises.map((name) => <option key={name} value={name} />)}</datalist>
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
