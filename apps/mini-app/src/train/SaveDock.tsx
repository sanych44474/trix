import { useEffect, useRef, useState } from "react";
import { canUseMainButton, showMainButton } from "../telegram";
import { t, type Lang } from "../i18n";
import { fmtDuration } from "../logic/rest";
import { sessionElapsedSec, type SessionClock } from "../logic/logger";

export type SyncState = "idle" | "pending" | "synced" | "offline";

export type DockAction =
  | { kind: "finish" } // a day with no saved log yet: ends the session (asks first)
  | { kind: "update" } // an already-saved day with edits
  | { kind: "backfill"; date: string } // logging a past day
  | { kind: "saved" }; // nothing to save

function hhmm(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Pinned just above the bottom nav, next to the rest bar: the save state and the one action that
 * matters. The save button used to sit at the very end of a long exercise list while its
 * confirmation rendered at the very top, so a successful save looked like nothing happened --
 * and got tapped three more times.
 */
export function SaveDock({ lang, action, saving, disabled, savedAt, drafted, sync, queued, clock, filledSets, restBar, onPress }: {
  lang: Lang;
  action: DockAction;
  saving: boolean;
  disabled: boolean;
  savedAt: number | undefined;
  drafted: boolean;
  sync: SyncState;
  queued?: boolean;
  clock: SessionClock | undefined;
  filledSets: number;
  restBar: React.ReactNode;
  onPress: () => void;
}) {
  // Inside Telegram the action moves to the native bottom button (outside the webview, always
  // visible, looks like Telegram itself); the dock keeps the timer and the save status. The
  // handler goes through a ref so the button isn't re-bound on every render of the timer.
  const [native] = useState(canUseMainButton);
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const buttonDisabled = disabled || saving || action.kind === "saved";

  // Re-render once a second only while the clock is actually running.
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(clock && !clock.endedAt);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = sessionElapsedSec(clock, running ? now : Date.now());
  const status = saving
    ? t(lang, "saving_ellipsis")
    : action.kind === "saved" && queued
      ? t(lang, "dock_saved_offline")
      : action.kind === "saved" && savedAt
      ? t(lang, "dock_saved_at", { time: hhmm(savedAt) })
      : drafted
        ? sync === "synced" ? t(lang, "dock_draft_synced") : sync === "offline" ? t(lang, "dock_draft_offline") : t(lang, "dock_draft_local")
        : filledSets === 0 ? t(lang, "dock_not_started") : "";
  const label = saving
    ? t(lang, "saving_ellipsis")
    : action.kind === "finish" ? t(lang, "finish_workout_btn")
      : action.kind === "update" ? t(lang, "save_changes_btn")
        : action.kind === "backfill" ? t(lang, "save_for_date", { date: action.date })
          : t(lang, "saved_btn");
  useEffect(() => {
    if (!native) return;
    return showMainButton({ text: label, active: !buttonDisabled, progress: saving }, () => { if (!buttonDisabled) pressRef.current(); });
  }, [native, label, buttonDisabled, saving]);

  return (
    <div className="train-dock">
      {restBar}
      <div className={`save-dock${sync === "offline" && drafted ? " offline" : ""}`} role="status" aria-live="polite">
        <div className="save-dock-meta">
          {elapsed > 0 && <strong>⏱ {fmtDuration(elapsed)}</strong>}
          {status && <small>{status}</small>}
        </div>
        {!native && <button type="button" className="button button-primary" disabled={buttonDisabled} onClick={onPress}>{label}</button>}
      </div>
    </div>
  );
}
