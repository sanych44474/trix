// "The app came back": Telegram keeps a Mini App alive when it is minimised or the chat is left,
// so reopening it shows the page as it was -- a plan the trainer has changed since stayed the old
// one until the app was closed for good. Calls `onResume` when the app is shown again after being
// away for at least `minAwayMs` (a glance at a notification doesn't count).
import { useEffect, useRef } from "react";
import { onTelegramEvent } from "./telegram";

export function useResume(onResume: () => void, minAwayMs = 60_000): void {
  const latest = useRef(onResume);
  latest.current = onResume;
  useEffect(() => {
    let hiddenAt: number | null = null;
    const away = () => { hiddenAt ??= Date.now(); };
    const back = () => {
      if (hiddenAt !== null && Date.now() - hiddenAt >= minAwayMs) latest.current();
      hiddenAt = null;
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
    document.addEventListener("visibilitychange", onVisibility);
    const offDeactivated = onTelegramEvent("deactivated", away);
    const offActivated = onTelegramEvent("activated", back);
    return () => { document.removeEventListener("visibilitychange", onVisibility); offDeactivated(); offActivated(); };
  }, [minAwayMs]);
}
