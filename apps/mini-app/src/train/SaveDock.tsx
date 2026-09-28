import { useEffect, useState } from "react";
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
export function SaveDock({ lang, action, saving, disabled, savedAt, drafted, sync, clock, filledSets, restBar, onPress }: {
  lang: Lang;
  action: DockAction;
  saving: boolean;
  disabled: boolean;
  savedAt: number | undefined;
  drafted: boolean;
  sync: SyncState;
  clock: SessionClock | undefined;
  filledSets: number;
  restBar: React.ReactNode;
  onPress: () => void;
}) {
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
  return (
    <div className="train-dock">
      {restBar}
      <div className={`save-dock${sync === "offline" && drafted ? " offline" : ""}`} role="status" aria-live="polite">
        <div className="save-dock-meta">
          {elapsed > 0 && <strong>⏱ {fmtDuration(elapsed)}</strong>}
          {status && <small>{status}</small>}
        </div>
        <button type="button" className="button button-primary" disabled={disabled || saving || action.kind === "saved"} onClick={onPress}>{label}</button>
      </div>
    </div>
  );
}
