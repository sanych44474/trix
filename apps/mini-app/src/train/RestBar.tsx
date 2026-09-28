import { t, type Lang } from "../i18n";
import { fmtRest, REST_ADJUST_SEC, restRingPct } from "../logic/rest";
import type { RestState } from "./useSession";

export function RestBar({ lang, rest, density, streak, onAdjust, onSkip }: {
  lang: Lang;
  rest: RestState;
  density: number | null;
  streak: number;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
}) {
  const time = rest.done ? `+${fmtRest(rest.over)}` : fmtRest(rest.left);
  return (
    <div className={rest.done ? "rest-bar over" : "rest-bar"} role="status" aria-live="polite">
      <div className="rest-ring" style={{ ["--rest-pct" as string]: `${restRingPct(rest.target, rest.left)}%` }}><span>{time}</span></div>
      <div className="rest-meta">
        <strong>{rest.done ? t(lang, "train_rest_over_label") : t(lang, "train_resting_label", { time: fmtRest(rest.left) })}</strong>
        <small>
          {rest.label ? `${rest.label} · ` : ""}
          {density !== null ? t(lang, "rest_bar_density", { n: density }) : ""}
          {streak > 1 ? ` · 🎯 ${streak}` : ""}
        </small>
      </div>
      <div className="rest-actions">
        <button type="button" className="rest-adjust" onClick={() => onAdjust(-REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_minus_aria", { sec: REST_ADJUST_SEC })}>−{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-adjust" onClick={() => onAdjust(REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_plus_aria", { sec: REST_ADJUST_SEC })}>+{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-skip" onClick={onSkip}>{t(lang, "train_rest_skip_btn")}</button>
      </div>
    </div>
  );
}
