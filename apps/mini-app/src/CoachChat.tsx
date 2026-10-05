// The AI coach as a chat in the Mini App — the same coach as the bot (plan + progression-engine
// context, coachEditSystem), with a short memory (the last turns go back with each question)
// and its buttons: plan edits applied through the plan editor (/api/v2/plan) and "send to the
// team" feedback (/api/v2/coach/feedback). The conversation survives leaving the screen for this
// app session (sessionStorage).
import { useEffect, useRef, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Lang } from "./i18n";

type Action = { label: string; kind: string; weekday?: number; index?: number; exercise?: string; value?: string; note?: string };
type Turn = { role: "user" | "coach"; text: string; actions?: Action[]; done?: number[] };

const KEY = "trix:v2:coach-chat";
const load = (): Turn[] => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Turn[]; } catch { return []; } };
const store = (turns: Turn[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30))); } catch { /* optional */ } };

const PLAN_ACTION: Record<string, "weight" | "sets" | "del" | "swap" | "add"> = { weight: "weight", sets: "sets", delete: "del", swap: "swap", add: "add" };

export function CoachChat({ lang }: { lang: Lang }) {
  const [turns, setTurns] = useState<Turn[]>(load);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { store(turns); endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.slice(-6).map((x) => ({ role: x.role, text: x.text.slice(0, 1500) }));
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setQuestion(""); setBusy("ask"); setError(false);
    try {
      const r = await api<{ answer?: string; actions?: Action[] }>("/api/v2/coach/ask", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"askCoach">({ question: q, history }) });
      setTurns((prev) => [...prev, { role: "coach", text: r.answer || t(lang, "generic_error"), actions: r.actions ?? [] }]);
    } catch {
      setError(true);
    } finally { setBusy(null); }
  };

  const apply = async (turnIdx: number, i: number, a: Action) => {
    const key = `${turnIdx}:${i}`;
    setBusy(key); setError(false);
    try {
      if (a.kind === "feedback") {
        await api("/api/v2/coach/feedback", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"sendCoachFeedback">({ summary: a.value ?? "", ...(a.note ? { original: a.note } : {}) }) });
      } else {
        const action = PLAN_ACTION[a.kind];
        if (!action || !a.weekday) throw new Error("unsupported");
        await api("/api/v2/plan", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editPlan">({ action, weekday: a.weekday, index: a.index ?? -1, value: a.kind === "swap" || a.kind === "add" ? a.exercise : a.value }) });
      }
      setTurns((prev) => prev.map((x, j) => (j === turnIdx ? { ...x, done: [...(x.done ?? []), i] } : x)));
    } catch { setError(true); } finally { setBusy(null); }
  };

  return <div className="coach-chat">
    {turns.length === 0 && <p className="muted">{t(lang, "coach_chat_intro")}</p>}
    <div className="message-thread">
      {turns.map((x, ti) => <div className={x.role === "user" ? "message-row message-mine" : "message-row"} key={ti}>
        <p>{x.text}</p>
        {x.actions?.length ? <div className="coach-actions">{x.actions.map((a, i) => {
          const done = x.done?.includes(i);
          return <button type="button" key={i} className={`choice-button${done ? " done" : ""}`} disabled={done || busy !== null} onClick={() => void apply(ti, i, a)}>
            {done ? `✓ ${a.kind === "feedback" ? t(lang, "coach_feedback_sent") : t(lang, "coach_action_done")}` : busy === `${ti}:${i}` ? "…" : a.label}
          </button>;
        })}</div> : null}
      </div>)}
      {busy === "ask" && <div className="message-row typing"><p>…</p></div>}
      <div ref={endRef} />
    </div>
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    <form className="coach-input" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
      <textarea value={question} maxLength={500} rows={2} placeholder={t(lang, "ai_coach_ph")} onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }} />
      <button className="button button-primary" type="submit" disabled={!question.trim() || busy !== null}>{t(lang, "ai_coach_ask_btn")}</button>
    </form>
    {turns.length > 0 && <button type="button" className="text-button" onClick={() => setTurns([])}>{t(lang, "coach_chat_clear")}</button>}
  </div>;
}
