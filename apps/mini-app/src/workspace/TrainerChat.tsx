// The trainer <-> client chat thread. Both sides use this: a client with `peerId` unset (their
// own trainer), a trainer with the client's id. Refreshes every few seconds while on screen;
// voice notes go through the transcriber into the box. The trainer can ask the AI for a draft
// reply in their style -- it only fills the box.
import { useEffect, useRef, useState } from "react";
import { api, typedBody } from "../api";
import { t, type Lang } from "../i18n";
import type { ChatThread } from "../types";
import { track } from "../logic/track";
import { VoiceButton } from "../media/VoiceButton";

const POLL_MS = 5000;

export function TrainerChat({ lang, peerId, canDraft, prefill }: { lang: Lang; peerId?: number; canDraft?: boolean; prefill?: string }) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState(prefill ?? "");
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [error, setError] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const query = peerId ? `?with=${peerId}` : "";

  const load = () => api<ChatThread>(`/api/v2/chat${query}`).then((data) => { setThread(data); setMissing(false); }).catch(() => setMissing(true));

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [query]);

  useEffect(() => {
    const n = thread?.messages.length ?? 0;
    if (n !== lastCount.current) { lastCount.current = n; endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }
  }, [thread]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy("send"); setError(false);
    try {
      await api("/api/v2/chat", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"sendChatMessage">({ text: body, ...(peerId ? { with: peerId } : {}) }) });
      setText("");
      track(peerId ? "app_chat_trainer_sent" : "app_chat_client_sent");
      await load();
    } catch { setError(true); } finally { setBusy(null); }
  };

  const draft = async () => {
    if (!peerId) return;
    setBusy("draft"); setError(false);
    try {
      const r = await api<{ draft: string }>("/api/v2/chat/draft", { method: "POST", body: typedBody<"draftChatReply">({ with: peerId }) });
      if (r.draft) setText(r.draft); else setError(true);
    } catch { setError(true); } finally { setBusy(null); }
  };

  if (missing && !thread) return <p className="muted">{t(lang, "chat_unavailable")}</p>;
  if (!thread) return <div className="skeleton" />;
  return <div className="coach-chat trainer-chat">
    {thread.messages.length === 0 && <p className="muted">{t(lang, thread.peer.isTrainer ? "chat_empty_client" : "chat_empty_trainer", { name: thread.peer.name || t(lang, "your_trainer_fallback") })}</p>}
    <div className="message-thread">
      {thread.messages.map((m) => <div className={m.fromMe ? "message-row message-mine" : "message-row"} key={m.id}>
        <p>{m.text}</p>
        <small>{m.createdAt.slice(5, 16).replace("T", " ")}{m.fromMe && m.read ? " ✓✓" : m.fromMe ? " ✓" : ""}</small>
      </div>)}
      <div ref={endRef} />
    </div>
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    <form className="coach-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea value={text} maxLength={2000} rows={2} placeholder={t(lang, "chat_input_ph")} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <VoiceButton lang={lang} disabled={busy !== null} onText={(spoken) => setText((cur) => (cur.trim() ? `${cur.trim()} ${spoken}` : spoken).slice(0, 2000))} />
      <button className="button button-primary" type="submit" disabled={!text.trim() || busy !== null}>{busy === "send" ? "…" : t(lang, "chat_send_btn")}</button>
    </form>
    {canDraft && thread.messages.some((m) => !m.fromMe) && <button type="button" className="text-button" disabled={busy !== null} onClick={() => void draft()}>{busy === "draft" ? "…" : `✨ ${t(lang, "chat_ai_draft_btn")}`}</button>}
  </div>;
}
