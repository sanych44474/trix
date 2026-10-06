// Record a voice note in the app and get its text: tap to start, tap to stop (stops itself at
// 60 s). The transcript goes to `onText`; the caller puts it into its input so the user can
// check it before sending (Whisper mishears gym slang). Hidden where the WebView cannot record.
import { useEffect, useRef, useState } from "react";
import { apiForm } from "../api";
import { t, type Lang } from "../i18n";
import { MAX_VOICE_SEC, pickAudioType } from "../logic/media";
import { track } from "../logic/track";

export function canRecord(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function VoiceButton({ lang, onText, disabled }: { lang: Lang; onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((tr) => tr.stop()); }, []);
  if (!canRecord()) return null;

  const stop = () => { if (recorder.current?.state === "recording") recorder.current.stop(); };

  const start = async () => {
    setError(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { setError(t(lang, "voice_no_mic")); return; }
    const type = pickAudioType((x) => MediaRecorder.isTypeSupported(x));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      if (timer.current) window.clearInterval(timer.current);
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      if (blob.size < 1000) { setState("idle"); return; }
      setState("sending");
      try {
        const form = new FormData();
        form.append("audio", blob, `voice.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
        const r = await apiForm<{ text: string }>("/api/v2/media/transcribe", form);
        if (r.text) { onText(r.text); track("app_voice_ok"); } else setError(t(lang, "voice_unclear_app"));
      } catch { setError(t(lang, "generic_error")); } finally { setState("idle"); }
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0); setState("recording");
    const began = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_VOICE_SEC) stop();
    }, 250);
  };

  return <span className="voice-wrap">
    <button type="button" className={`voice-button${state === "recording" ? " recording" : ""}`} disabled={disabled || state === "sending"}
      aria-label={t(lang, state === "recording" ? "voice_stop" : "voice_record")}
      onClick={() => (state === "recording" ? stop() : void start())}>
      {state === "sending" ? "…" : state === "recording" ? `■ ${seconds}s` : "🎙"}
    </button>
    {error && <small className="voice-error">{error}</small>}
  </span>;
}
