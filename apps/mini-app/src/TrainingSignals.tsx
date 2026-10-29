import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Key, type Lang } from "./i18n";

// Advisory Clef signals from GET /api/v2/training-signals (server-cached per user per UTC day).
// Advisory only: nothing here changes the plan. Every failure renders nothing.
export interface TrainingSignals {
  exercises: Array<{ name: string; status: "progressing" | "stalled" | "regressing"; confidence: number }>;
  deload: { probability: number; suggested: boolean } | null;
  computedAt: string;
}

export function useTrainingSignals(): TrainingSignals | null {
  const [signals, setSignals] = useState<TrainingSignals | null>(null);
  useEffect(() => {
    let live = true;
    api<TrainingSignals>("/api/v2/training-signals").then(
      (next) => { if (live) setSignals(next); },
      () => { /* advisory: show nothing */ },
    );
    return () => { live = false; };
  }, []);
  return signals;
}

const TONE: Record<TrainingSignals["exercises"][number]["status"], string> = {
  progressing: "pill-good",
  stalled: "pill-warn",
  regressing: "pill-bad",
};

/** One badge per lift on the Progress training section (the server already drops low-confidence lifts). */
export function LiftSignalBadges({ lang, signals }: { lang: Lang; signals: TrainingSignals | null }) {
  if (!signals?.exercises.length) return null;
  return (
    <div className="signal-badges">
      {signals.exercises.map((e) => (
        <span key={e.name} className={`pill ${TONE[e.status]}`}>
          {e.name} · {t(lang, `signal_lift_${e.status}` as Key)}
        </span>
      ))}
    </div>
  );
}

/** Gentle hint on Today. Shown by the caller only when the server says `suggested`. */
export function DeloadHintCard({ lang }: { lang: Lang }) {
  return (
    <section className="card card-muted" aria-label={t(lang, "deload_hint_title")}>
      <h2 className="card-title">{t(lang, "deload_hint_title")}</h2>
      <p className="muted">{t(lang, "deload_hint_detail")}</p>
    </section>
  );
}
