// Display theme: Telegram's own light/dark scheme, or the opt-in high-contrast theme, plus the
// accent colour (the journal's green, or red) on top of either scheme. Both are preferences of this device, so it lives in localStorage and is mirrored to
// Telegram DeviceStorage (like the offline queue) to survive the WebView clearing its storage.
import { mirrorToDevice, restoreFromDevice } from "./deviceStorage";
import { syncFrameColors } from "../telegram";

export const CONTRAST_KEY = "trix:v2:contrast";
export const ACCENT_KEY = "trix:v2:accent";
export type Theme = "light" | "dark" | "contrast";
export type Accent = "green" | "red";

export function readAccent(): Accent {
  try { return localStorage.getItem(ACCENT_KEY) === "red" ? "red" : "green"; } catch { return "green"; }
}

/** The accent applies to the light and dark schemes; high contrast keeps its own fixed colours. */
export function resolveAccent(accent: Accent, theme: Theme | null): Accent | null {
  return accent === "red" && theme !== "contrast" ? "red" : null;
}

export function readContrast(): boolean {
  try { return localStorage.getItem(CONTRAST_KEY) === "1"; } catch { return false; }
}

/** High contrast wins over Telegram's scheme; null leaves the stylesheet's prefers-color-scheme default. */
export function resolveTheme(contrast: boolean, scheme: "light" | "dark" | undefined): Theme | null {
  return contrast ? "contrast" : scheme ?? null;
}

export function applyTheme(): void {
  const theme = resolveTheme(readContrast(), window.Telegram?.WebApp?.colorScheme);
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const accent = resolveAccent(readAccent(), theme);
  if (accent) root.dataset.accent = accent;
  else delete root.dataset.accent;
  syncFrameColors();
}

export function setContrast(on: boolean): void {
  try {
    if (on) localStorage.setItem(CONTRAST_KEY, "1");
    else localStorage.removeItem(CONTRAST_KEY);
  } catch { /* storage is optional; the theme still applies for this session */ }
  mirrorToDevice(CONTRAST_KEY);
  applyTheme();
}

export function setAccent(accent: Accent): void {
  try {
    if (accent === "red") localStorage.setItem(ACCENT_KEY, "red");
    else localStorage.removeItem(ACCENT_KEY);
  } catch { /* storage is optional; the accent still applies for this session */ }
  mirrorToDevice(ACCENT_KEY);
  applyTheme();
}

/** When the WebView lost the preferences but DeviceStorage kept them, put them back and repaint. */
export function restoreContrast(): void {
  void Promise.all([restoreFromDevice(CONTRAST_KEY), restoreFromDevice(ACCENT_KEY)])
    .then((restored) => { if (restored.some(Boolean)) applyTheme(); });
}
