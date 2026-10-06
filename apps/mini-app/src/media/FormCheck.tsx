// Form check in the app: film a set (or pick a clip up to 60 s), the AI coach watches it and
// answers with 2–3 technique cues. A few checks a day (the costliest AI call); the server
// enforces the same limits checked here before uploading.
import { useRef, useState } from "react";
import { apiForm } from "../api";
import { t, type Lang } from "../i18n";
import { MAX_VIDEO_SEC, videoCheck } from "../logic/media";
import { track } from "../logic/track";
import { videoSeconds } from "./files";

type Result = { ok: boolean; text?: string; reason?: "too_big" | "too_long" | "limit" | "failed"; limit?: number };

export function FormCheck({ lang, exercise }: { lang: Lang; exercise?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState(exercise ?? "");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reasonText = (reason: Result["reason"], limit?: number) => t(lang, `form_check_${reason ?? "failed"}_app`, { n: limit ?? 5, sec: MAX_VIDEO_SEC });

  const send = async (file: File) => {
    setAnswer(null); setNote(null);
    // Size first: reading a clip's header loads it into memory, pointless for a 200 MB file.
    const seconds = videoCheck(file.size) === "ok" ? await videoSeconds(file) : undefined;
    const gate = videoCheck(file.size, seconds);
    if (gate !== "ok") { setNote(reasonText(gate)); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("video", file, file.name || "set.mp4");
      if (caption.trim()) form.append("caption", caption.trim());
      if (seconds) form.append("seconds", String(Math.round(seconds)));
      const r = await apiForm<Result>("/api/v2/media/form-check", form);
      if (r.ok && r.text) { setAnswer(r.text); track("app_form_check"); } else setNote(reasonText(r.reason, r.limit));
    } catch { setNote(t(lang, "generic_error")); } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return <div className="form-check">
    <p className="muted">{t(lang, "form_check_intro", { sec: MAX_VIDEO_SEC })}</p>
    <input className="meal-photo-caption" value={caption} maxLength={120} placeholder={t(lang, "form_check_caption_ph")} onChange={(e) => setCaption(e.target.value)} />
    <input ref={input} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
    <button type="button" className="button button-primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? t(lang, "form_check_watching_app") : `🎥 ${t(lang, "form_check_btn")}`}</button>
    {answer && <div className="info-box form-check-answer">{answer}<small className="muted">{t(lang, "form_check_disclaimer")}</small></div>}
    {note && <div className="save-note">{note}</div>}
  </div>;
}
