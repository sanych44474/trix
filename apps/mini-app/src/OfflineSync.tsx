// Sends workout saves that were made without a connection (logic/offlineSaves.ts) once the
// network is back, and says so: a quiet "waiting for network" line while any are queued, then
// a short confirmation when they're through.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { t, type Lang } from "./i18n";
import { flushQueue, OFFLINE_SAVES_KEY, readQueue } from "./logic/offlineSaves";
import { mirrorToDevice, restoreFromDevice } from "./logic/deviceStorage";

export function OfflineSync({ lang }: { lang: Lang }) {
  const [pending, setPending] = useState(() => { try { return readQueue(localStorage).length; } catch { return 0; } });
  const [sent, setSent] = useState(0);
  // Saves the server refused for good (a day outside the edit window, say). They used to vanish.
  const [dropped, setDropped] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    const flush = async () => {
      if (busy.current || !navigator.onLine) { try { setPending(readQueue(localStorage).length); } catch { /* storage is optional */ } return; }
      busy.current = true;
      try {
        const r = await flushQueue(localStorage, (q) =>
          api("/api/v2/workout/save", { method: "POST", idempotencyKey: q.key, body: JSON.stringify(q.body) }).then(() => undefined));
        setPending(r.remaining);
        if (r.sent) setSent((n) => n + r.sent);
        if (r.dropped) setDropped((n) => n + r.dropped);
        mirrorToDevice(OFFLINE_SAVES_KEY);
      } catch { /* storage unavailable: nothing to flush */ } finally { busy.current = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void flush(); };
    // A queue the WebView forgot but Telegram's DeviceStorage kept comes back before the first flush.
    void restoreFromDevice(OFFLINE_SAVES_KEY).then(() => flush());
    window.addEventListener("online", flush);
    window.addEventListener("trix:offline-save", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("trix:offline-save", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(0), 6000);
    return () => clearTimeout(id);
  }, [sent]);

  if (dropped) return <div className="offline-banner" role="alert">{t(lang, "offline_dropped", { n: dropped })} <button type="button" className="text-button" onClick={() => setDropped(0)}>{t(lang, "close")}</button></div>;
  if (pending) return <div className="offline-banner" role="status">{t(lang, "offline_pending", { n: pending })}</div>;
  if (sent) return <div className="offline-banner done" role="status">{t(lang, "offline_synced", { n: sent })}</div>;
  return null;
}
