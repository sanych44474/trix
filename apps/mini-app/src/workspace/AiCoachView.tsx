// The AI coach chat screen, opened from Today, the Workspace spaces and deep links.
import { useEffect, useState } from "react";
import { api } from "../api";
import { CoachChat } from "../CoachChat";
import type { CoachThread } from "../types";
import { t, type Lang } from "../i18n";
import { Panel } from "./shared";
import { TrainerChat } from "./TrainerChat";

/**
 * One screen, two flows: a solo athlete (or a trainer about their own training) talks to the AI
 * coach; a client with a human trainer gets the chat with that trainer (TrainerChat), plus any
 * questions still waiting from the older ask-a-question flow.
 */
export function AiCoachView({ lang, onBack, routed, prefill }: { lang: Lang; onBack: () => void; routed: boolean; prefill?: string }) {
  const [thread, setThread] = useState<CoachThread | null>(null);

  const loadThread = () => { if (routed) api<CoachThread>("/api/v2/coach/thread").then(setThread).catch(() => setThread(null)); };
  useEffect(loadThread, [routed]);

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, routed ? "ask_trainer_eyebrow" : "ai_coach_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, routed ? "ask_trainer_title" : "ai_coach_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {!routed && <Panel><CoachChat lang={lang} prefill={prefill} /></Panel>}
    {routed && <Panel>
      <p className="muted">{t(lang, "chat_with_trainer_detail", { name: thread?.trainer?.name || t(lang, "your_trainer_fallback") })}</p>
      <TrainerChat lang={lang} prefill={prefill} />
    </Panel>}
    {routed && thread && thread.questions.some((q) => q.status !== "answered") && <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "ask_trainer_thread_eyebrow")}</span><h2>{t(lang, "chat_open_questions_title")}</h2></div></div>
      {thread.questions.filter((q) => q.status !== "answered").map((q) => <div className="record-row" key={q.id}><div><strong>{q.text}</strong><small>{q.createdAt.slice(0, 10)}</small></div><span className="status-badge status-attention">{t(lang, "awaiting_reply_label")}</span></div>)}
    </Panel>}
  </div>;
}
