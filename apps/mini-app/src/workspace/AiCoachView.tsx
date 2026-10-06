// The AI coach chat screen, opened from Today, the Workspace spaces and deep links.
import { useEffect, useState } from "react";
import { api, typedBody } from "../api";
import { CoachChat } from "../CoachChat";
import type { CoachThread } from "../types";
import { t, type Lang } from "../i18n";
import { Panel } from "./shared";

/** Single-turn "ask the AI coach" screen — solo/trainer self-coaching only (see coachApi.ts for
 * why a client with a trainer doesn't get this: their questions route to a human, not here). */
/**
 * One screen, two flows, because the backend has two: a solo athlete (or a trainer asking about
 * their own training) gets a direct AI answer, while a client with a human trainer has their
 * question routed to that trainer with an AI-drafted reply for the trainer to send. The client
 * branch used to be a plain 403, so the client role had no coach and no way to reach their
 * trainer from the app at all -- this renders the routed flow plus the resulting reply thread.
 */
export function AiCoachView({ lang, onBack, routed, prefill }: { lang: Lang; onBack: () => void; routed: boolean; prefill?: string }) {
  const [question, setQuestion] = useState(routed ? prefill ?? "" : "");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [thread, setThread] = useState<CoachThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const loadThread = () => { if (routed) api<CoachThread>("/api/v2/coach/thread").then(setThread).catch(() => setThread(null)); };
  useEffect(loadThread, [routed]);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true); setError(false); setAnswer(null); setSent(false);
    try {
      const result = await api<{ answer?: string; routed?: boolean }>("/api/v2/coach/ask", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"askCoach">({ question: question.trim() }) });
      if (result.routed) { setSent(true); setQuestion(""); loadThread(); } else setAnswer(result.answer ?? "");
    } catch { setError(true); } finally { setBusy(false); }
  };

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, routed ? "ask_trainer_eyebrow" : "ai_coach_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, routed ? "ask_trainer_title" : "ai_coach_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {!routed && <Panel><CoachChat lang={lang} prefill={prefill} /></Panel>}
    {routed && <Panel>
      <p className="muted">{t(lang, "ask_trainer_detail", { name: thread?.trainer?.name || t(lang, "your_trainer_fallback") })}</p>
      <label className="form-field"><span>{t(lang, routed ? "ask_trainer_question_label" : "ai_coach_question_label")}</span><textarea value={question} maxLength={500} placeholder={t(lang, "ai_coach_ph")} onChange={(event) => setQuestion(event.target.value)} /></label>
      <div className="button-row"><button className="button button-primary" disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? t(lang, "saving_ellipsis") : t(lang, routed ? "ask_trainer_send_btn" : "ai_coach_ask_btn")}</button></div>
      {sent && <div className="save-note">{t(lang, "ask_trainer_sent_note")}</div>}
      {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </Panel>}
    {answer !== null && <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "ai_coach_answer_eyebrow")}</span></div></div><p>{answer}</p></Panel>}
    {routed && thread && (thread.messages.length > 0 || thread.questions.length > 0) && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "ask_trainer_thread_eyebrow")}</span><h2>{t(lang, "ask_trainer_thread_title")}</h2></div><span className="tag">{t(lang, "n_open", { n: thread.questions.filter((q) => q.status !== "answered").length })}</span></div>
      {thread.messages.length > 0 && <div className="message-thread">{thread.messages.map((message, index) => <div className={message.fromMe ? "message-row message-mine" : "message-row"} key={`${message.createdAt}-${index}`}><p>{message.text}</p><small>{message.createdAt.slice(0, 10)}</small></div>)}</div>}
      {thread.questions.filter((q) => q.status !== "answered").map((q) => <div className="record-row" key={q.id}><div><strong>{q.text}</strong><small>{q.createdAt.slice(0, 10)}</small></div><span className="status-badge status-attention">{t(lang, "awaiting_reply_label")}</span></div>)}
    </Panel>}
  </div>;
}
