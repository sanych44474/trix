import { t, type Lang } from "../i18n";
import { fmtRest, REST_ADJUST_SEC, restRingPct } from "../logic/rest";
import type { RestState } from "./useSession";

/** The rest timer, pinned to the bottom of the focus screen: a large clock, −15 / +15 and "Next"
 *  (stop the rest) under the thumb, and a bar that empties as the rest runs out. */
export function RestBar({ lang, rest, onAdjust, onSkip }: {
  lang: Lang;
  rest: RestState;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
}) {
  const time = rest.done ? `+${fmtRest(rest.over)}` : fmtRest(rest.left);
  return (
    <div className={rest.done ? "rest-bar over" : "rest-bar"} role="status" aria-live="polite">
      <div className="rest-main">
        <span className="rest-label">{rest.done ? t(lang, "train_rest_over_label") : rest.label || t(lang, "train_resting_label")}</span>
        <span className="rest-time num">{time}</span>
      </div>
      <div className="rest-actions">
        <button type="button" className="rest-adjust num" onClick={() => onAdjust(-REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_minus_aria", { sec: REST_ADJUST_SEC })}>−{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-adjust num" onClick={() => onAdjust(REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_plus_aria", { sec: REST_ADJUST_SEC })}>+{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-skip" onClick={onSkip}>{t(lang, "train_rest_next_btn")}</button>
      </div>
      <div className="rest-track" aria-hidden="true"><span style={{ width: `${100 - restRingPct(rest.target, rest.left)}%` }} /></div>
    </div>
  );
}
