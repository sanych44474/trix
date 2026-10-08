// Telegram's own controls around the app: haptic feedback on buttons, the "Settings" item in the
// Mini App's menu, and the native Back button. Moved out of App() unchanged.
import { useEffect } from "react";
import type { View } from "./logic/navigation";

export function useTelegramChrome(view: View, setView: (view: View) => void) {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("button")) window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Telegram's own "Settings" item in the Mini App's ⋮ menu (SettingsButton, 7.0+) opens our settings.
  useEffect(() => {
    const sb = window.Telegram?.WebApp.SettingsButton;
    if (!sb) return;
    const open = () => setView("settings");
    sb.show();
    sb.onClick(open);
    return () => sb.offClick(open);
  }, []);

  // Back goes to Today from every other screen, and is hidden on Today itself.
  useEffect(() => {
    const back = window.Telegram?.WebApp.BackButton;
    if (!back) return;
    if (view === "today") { back.hide(); return; }
    const handler = () => setView("today");
    back.show();
    back.onClick(handler);
    return () => back.offClick(handler);
  }, [view]);
}
