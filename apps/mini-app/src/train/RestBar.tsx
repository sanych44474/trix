import { t, type Lang } from "../i18n";
import { useEffect, useState } from "react";
import { fmtRest, REST_ADJUST_SEC, restProgress, restRingPct } from "../logic/rest";
import type { RestState } from "./useSession";

/** The rest timer, pinned to the bottom of the focus screen: a large clock, −15 / +15 and "Next"
 *  (stop the rest) under the thumb, and a bar that empties as the rest runs out. */
export function RestBar({ lang, rest, onAdjust, onSkip }: {
  lang: Lang;
  rest: RestState;
  onAdjust: (delta: number) => void;
  onSkip: () => void;
}) {
  // The bar keeps its own clock, so a running rest re-renders this bar and nothing else.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (rest.endAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [rest.endAt]);
  const live = rest.endAt != null ? restProgress(rest.endAt, now) : { left: rest.left, over: rest.over, done: rest.done };
  const done = rest.done || live.done;
  const time = done ? `+${fmtRest(live.over)}` : fmtRest(live.left);
  // transform, not width: a scaled bar is composited on the GPU; a width change re-lays out the
  // pinned bar on every animation frame of every tick.
  const fill = (100 - restRingPct(rest.target, live.left)) / 100;
  return (
    <div className={done ? "rest-bar over" : "rest-bar"} role="status" aria-live="polite">
      <div className="rest-main">
        <span className="rest-label">{done ? t(lang, "train_rest_over_label") : rest.label || t(lang, "train_resting_label")}</span>
        <span className="rest-time num">{time}</span>
      </div>
      <div className="rest-actions">
        <button type="button" className="rest-adjust num" onClick={() => onAdjust(-REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_minus_aria", { sec: REST_ADJUST_SEC })}>−{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-adjust num" onClick={() => onAdjust(REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_plus_aria", { sec: REST_ADJUST_SEC })}>+{REST_ADJUST_SEC}</button>
        <button type="button" className="rest-skip" onClick={onSkip}>{t(lang, "train_rest_next_btn")}</button>
      </div>
      <div className="rest-track" aria-hidden="true"><span style={{ transform: `scaleX(${fill})` }} /></div>
    </div>
  );
}
