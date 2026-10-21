// Training extras brought over from the bot: cardio templates + quick cardio log (Training view),
// strength standards (Progress, train section) and the post-vacation comeback interview (Today).
// The server returns the questions, button labels and template names already in the user's language.
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import { Card } from "./train/ui";

type CardioQuick = { key: string; name: string; label: string };
type CardioStep = { label: string; minutes: number; zone: number; reps: number; bpm: { lo: number; hi: number } };
type CardioTemplate = { key: string; emoji: string; name: string; totalMin: number; steps: CardioStep[] };
type CardioData = {
  quick: CardioQuick[];
  structured: { intro: string; zoneNote: string; templates: CardioTemplate[] };
  bpmLabel: string;
};

/** Cardio: the quick log (type + typed time/distance) and the structured sessions with the user's own zones. */
export function CardioPanel({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<CardioData | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<CardioQuick | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api<CardioData>("/api/v2/cardio").then(setData).catch(() => setFailed(true));
  }, []);

  const log = async () => {
    if (!picked || !text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ ok: boolean }>("/api/v2/log", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"quickLog">({ kind: "cardio", key: picked.key as never, text: text.trim() }),
      });
      if (r.ok) {
        setNote(t(lang, "tx_cardio_saved"));
        setText("");
        setPicked(null);
      } else {
        setNote(t(lang, "tx_cardio_unreadable"));
      }
    } catch {
      setNote(t(lang, "generic_error"));
    } finally {
      setBusy(false);
    }
  };

  const back = <button type="button" className="button button-ghost button-small" onClick={onBack}>{t(lang, "tx_back")}</button>;
  if (failed) return <div className="view-stack">{back}<Card tone="muted"><p>{t(lang, "generic_error")}</p></Card></div>;
  if (!data) return <div className="view-stack">{back}<div className="skeleton" /></div>;

  return (
    <div className="view-stack">
      {back}
      <div className="eyebrow">{t(lang, "tx_cardio_title")}</div>
      <Card>
        <h2 className="card-title">{t(lang, "tx_cardio_quick_title")}</h2>
        <div className="chip-row">
          {data.quick.map((c) => (
            <button key={c.key} type="button" className={`chip${picked?.key === c.key ? " active" : ""}`} onClick={() => { setPicked(c); setNote(null); }}>{c.label}</button>
          ))}
        </div>
        {picked && (
          <div className="input-row">
            <label>
              {t(lang, "tx_cardio_prompt", { type: picked.label })}
              <input value={text} maxLength={120} placeholder={t(lang, "tx_cardio_placeholder")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void log(); }} />
            </label>
            <button type="button" className="button button-primary" disabled={busy || !text.trim()} onClick={() => void log()}>{t(lang, "tx_cardio_log")}</button>
          </div>
        )}
        {note && <p className="muted" role="status">{note}</p>}
      </Card>
      <Card>
        <h2 className="card-title">{t(lang, "tx_cardio_structured_title")}</h2>
        <p className="muted">{data.structured.intro}</p>
        {data.structured.templates.map((tpl) => (
          <div key={tpl.key} className="volume-row">
            <div>
              <strong>{tpl.emoji} {tpl.name} · ~{tpl.totalMin}′</strong>
              {tpl.steps.map((st, i) => (
                <small key={i} style={{ display: "block" }}>
                  {st.reps > 1 ? `${st.reps}× ` : ""}{st.minutes}′ {st.label} · Z{st.zone} ({st.bpm.lo}–{st.bpm.hi} {data.bpmLabel})
                </small>
              ))}
            </div>
          </div>
        ))}
        <p className="muted">{data.structured.zoneNote}</p>
      </Card>
    </div>
  );
}

type Lift = { exercise: string; e1rm: number; ratio: number; levelLabel: string; nextLabel?: string; nextTargetKg?: number };
type Standards = { needsWeight: boolean; bodyweight: number | null; lifts: Lift[] };

/** Strength standards per big lift (bot: /std). Rendered in the Progress train section. */
export function StandardsCard({ lang }: { lang: Lang }) {
  const [data, setData] = useState<Standards | null>(null);
  useEffect(() => {
    api<Standards>("/api/v2/standards").then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  return (
    <Card>
      <h2 className="card-title">{t(lang, "tx_standards_title")}</h2>
      {data.needsWeight && <p className="muted">{t(lang, "tx_standards_needs_weight")}</p>}
      {!data.needsWeight && data.lifts.length === 0 && <p className="muted">{t(lang, "tx_standards_empty")}</p>}
      {!data.needsWeight && data.lifts.map((l) => (
        <div key={l.exercise} className="volume-row">
          <div>
            <strong>{l.exercise}: {l.levelLabel}</strong>
            <small style={{ display: "block" }}>
              {t(lang, "tx_standards_e1rm", { kg: l.e1rm, ratio: l.ratio.toFixed(2) })}
              {l.nextLabel && l.nextTargetKg ? ` · ${t(lang, "tx_standards_next", { level: l.nextLabel, kg: l.nextTargetKg })}` : ""}
            </small>
          </div>
        </div>
      ))}
      {data.bodyweight !== null && !data.needsWeight && <p className="muted">{t(lang, "tx_standards_bodyweight", { bw: data.bodyweight })}</p>}
    </Card>
  );
}

type ComebackStep = { key: string; kind: "text" | "buttons"; question: string; buttons?: { value: string; label: string }[] };
type ComebackState = { pending: boolean; steps: ComebackStep[] };

/**
 * The post-vacation comeback interview. Renders nothing unless the server says a comeback is pending
 * (the bot's `comeback` session mode, set when a vacation ends). Answers are sent once, with the decision.
 */
export function ComebackFlow({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [state, setState] = useState<ComebackState | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api<ComebackState>("/api/v2/comeback").then(setState).catch(() => setState(null));
  }, []);

  if (hidden || !state?.pending) return null;
  const steps = state.steps;

  const submit = async (decision: "keep" | "adjust" | "recreate") => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v2/comeback", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"answerComeback">({ answers: answers as never, decision }),
      });
      setResult(t(lang, decision === "keep" ? "tx_comeback_done_keep" : decision === "adjust" ? "tx_comeback_done_adjust" : "tx_comeback_done_recreate"));
      setState({ ...state, pending: false });
    } catch {
      setError(t(lang, "tx_comeback_error"));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Card tone="accent">
        <p>{result}</p>
        <button type="button" className="button button-ghost button-small" onClick={() => { setHidden(true); onDone(); }}>{t(lang, "tx_comeback_done")}</button>
      </Card>
    );
  }

  const step = steps[index];
  if (!step) return null;
  const isDecision = step.key === "decision";
  const answer = (value: string) => {
    const next = { ...answers, [step.key]: value };
    setAnswers(next);
    setText("");
    setIndex(index + 1);
    if (isDecision) void submit(value as "keep" | "adjust" | "recreate");
  };

  return (
    <Card tone="accent">
      <div className="eyebrow">{t(lang, "tx_comeback_title")}</div>
      <p className="muted">{t(lang, "tx_comeback_progress", { i: index + 1, n: steps.length })}</p>
      <h2 className="card-title">{step.question}</h2>
      {step.kind === "text" ? (
        <div className="input-row">
          <label>
            <input value={text} maxLength={300} placeholder={t(lang, "tx_comeback_text_placeholder")} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="button" className="button button-primary" disabled={!text.trim()} onClick={() => answer(text.trim())}>{t(lang, "tx_comeback_next")}</button>
        </div>
      ) : (
        <div className="chip-row">
          {(step.buttons ?? []).map((b) => (
            <button key={b.value} type="button" className="chip" disabled={busy} onClick={() => answer(b.value)}>{b.label}</button>
          ))}
        </div>
      )}
      {error && <p className="muted" role="alert">{error}</p>}
    </Card>
  );
}
