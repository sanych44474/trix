// Strava connection card: cardio from Strava lands in the workout log (src/features/strava).
// Renders nothing until the server reports the integration as configured.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Lang } from "./i18n";
import { openExternal } from "./telegram";

interface StravaStatus { available: boolean; connected: boolean; lastSyncAt?: string | null; lastError?: string | null }

export function StravaCard({ lang }: { lang: Lang }) {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [note, setNote] = useState("");
  const load = () => { api<StravaStatus>("/api/v2/strava").then(setStatus).catch(() => setStatus(null)); };
  useEffect(load, []);
  // Returning from the browser after authorizing: refresh the status.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  if (!status?.available) return null;

  const connect = async () => {
    setBusy("connect"); setNote("");
    try { const { url } = await api<{ url: string }>("/api/v2/strava/connect", { method: "POST" }); openExternal(url); }
    catch { setNote(t(lang, "generic_error")); } finally { setBusy(null); }
  };
  const sync = async () => {
    setBusy("sync"); setNote("");
    try { const r = await api<{ imported: number }>("/api/v2/strava/sync", { method: "POST" }); setNote(t(lang, "strava_synced_note", { n: r.imported })); load(); }
    catch { setNote(t(lang, "strava_sync_failed")); load(); } finally { setBusy(null); }
  };
  const disconnect = async () => {
    if (!window.confirm(t(lang, "strava_disconnect_confirm"))) return;
    setBusy("disconnect"); setNote("");
    try { await api("/api/v2/strava", { method: "DELETE" }); load(); } catch { setNote(t(lang, "generic_error")); } finally { setBusy(null); }
  };

  return (
    <section className="card card-default stack-card">
      <div className="section-head"><div><span className="eyebrow">Strava</span><h2>{status.connected ? t(lang, "strava_connected_card") : t(lang, "strava_title")}</h2></div></div>
      <p className="muted">
        {status.connected
          ? status.lastError ? t(lang, "strava_last_error") : status.lastSyncAt ? t(lang, "strava_last_sync", { date: status.lastSyncAt.slice(0, 16).replace("T", " ") }) : t(lang, "strava_waiting")
          : t(lang, "strava_detail")}
      </p>
      <div className="button-row">
        {status.connected ? (
          <>
            <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void sync()}>{busy === "sync" ? "…" : t(lang, "strava_sync_btn")}</button>
            <button type="button" className="text-button danger-button" disabled={busy !== null} onClick={() => void disconnect()}>{t(lang, "strava_disconnect_btn")}</button>
          </>
        ) : (
          <button type="button" className="button strava-button" disabled={busy !== null} onClick={() => void connect()}>{busy === "connect" ? "…" : t(lang, "strava_connect_btn")}</button>
        )}
      </div>
      {note && <div className="save-note">{note}</div>}
      <small className="muted">Powered by Strava</small>
    </section>
  );
}
