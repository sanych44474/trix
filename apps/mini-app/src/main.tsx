import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Offline shell (sw.template.js). Scope "/app-v2" (not "/app-v2/") so the bot's link, which has
// no trailing slash, is covered too -- allowed by the Service-Worker-Allowed header (public/_headers).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/app-v2/sw.js", { scope: "/app-v2", updateViaCache: "none" }).catch(() => {});
  });
}

window.Telegram?.WebApp.ready();
window.Telegram?.WebApp.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
