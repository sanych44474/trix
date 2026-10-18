// The current exercise's muscles inside focus mode (lazy chunk: the figure library is ~60 KB gzip).
// Folded, it is one row with a small front figure and the muscle names; open, front and back
// figures with the primary movers strong and the helpers light (same colours as Progress).
import Body, { type ExtendedBodyPart } from "react-muscle-highlighter";
import { t, type Key, type Lang } from "../i18n";
import { exerciseParts, PRIMARY_COLOR, SECONDARY_COLOR } from "../logic/bodyMap";
import type { ExerciseMuscles as Muscles } from "../logic/exerciseMuscles";
import { Icon } from "../icons";

const FIGURE_PARTS = [
  "abs", "adductors", "ankles", "biceps", "calves", "chest", "deltoids", "feet", "forearm", "gluteal", "hamstring",
  "hands", "hair", "head", "knees", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius", "triceps", "upper-back",
] as const;
const BACK_ONLY = new Set(["upper-back", "lower-back", "hamstring", "gluteal", "trapezius", "triceps"]);
const muscleLabel = (lang: Lang, slug: string) => t(lang, `muscle_${slug.replace("-", "_")}` as Key);

export function ExerciseMuscles({ lang, muscles, sex, open, onToggle }: {
  lang: Lang;
  muscles: Muscles;
  sex?: "male" | "female";
  open: boolean;
  onToggle: () => void;
}) {
  const css = getComputedStyle(document.documentElement);
  const base = css.getPropertyValue("--body-map-base").trim() || "#d3d9e2";
  const border = css.getPropertyValue("--body-map-border").trim() || "#aeb7c4";
  const lit = new Map(exerciseParts(muscles).map((p) => [p.slug as string, p.color]));
  const data: ExtendedBodyPart[] = FIGURE_PARTS.map((slug) => ({ slug, color: lit.get(slug) ?? (slug === "hair" ? border : base) }));
  // Folded, show the side where the main work is.
  const side = muscles.primary.length && muscles.primary.every((s) => BACK_ONLY.has(s)) ? "back" : "front";
  const figure = (s: "front" | "back") => <Body data={data} side={s} gender={sex ?? "male"} scale={1} border={border} defaultFill={base} />;
  const primary = muscles.primary.map((s) => muscleLabel(lang, s)).join(", ");
  const secondary = muscles.secondary.map((s) => muscleLabel(lang, s)).join(", ");

  return <div className={open ? "focus-muscles open" : "focus-muscles"}>
    <button type="button" className="focus-muscles-row" onClick={onToggle} aria-expanded={open}>
      {!open && <span className="focus-muscles-thumb" aria-hidden="true">{figure(side)}</span>}
      <span className="grow">
        <span className="focus-muscles-label">{t(lang, "focus_muscles_label")}</span>
        <strong><i className="dot" style={{ background: PRIMARY_COLOR }} />{primary}</strong>
        {secondary && <small><i className="dot" style={{ background: SECONDARY_COLOR }} />{secondary}</small>}
      </span>
      <Icon name="chevron" size={20} className={open ? "row-chevron open" : "row-chevron"} />
    </button>
    {open && <div className="focus-muscles-figures" aria-hidden="true">{figure("front")}{figure("back")}</div>}
  </div>;
}
