import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { guessLang, loadLang, type Lang } from "./i18n";
import "./styles.css";
import { ErrorBoundary } from "./ErrorBoundary";
import { installErrorReporting } from "./logic/errorReport";
import { applyTheme, restoreContrast } from "./logic/theme";

installErrorReporting();

// Offline shell (sw.template.js). Scope "/app-v2" (not "/app-v2/") so the bot's link, which has
// no trailing slash, is covered too -- allowed by the Service-Worker-Allowed header (public/_headers).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/app-v2/sw.js", { scope: "/app-v2", updateViaCache: "none" }).catch(() => {});
  });
}

window.Telegram?.WebApp.ready();
window.Telegram?.WebApp.expand();
// Paint the theme before the first render so a high-contrast choice never flashes the default.
applyTheme();
restoreContrast();

// Only the person's language is loaded before the first render (each is its own chunk): the
// one the last dashboard said, else Telegram's hint. A switch later loads the other on demand.
function initialLang(): Lang {
  try {
    const cached = JSON.parse(localStorage.getItem("trix:v2:dashboard") ?? "null") as { lang?: Lang } | null;
    if (cached?.lang === "en" || cached?.lang === "uk") return cached.lang;
  } catch { /* storage is optional */ }
  return guessLang();
}

const lang = initialLang();
void loadLang(lang).catch(() => {}).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary lang={lang}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
