// Display theme: Telegram's own light/dark scheme, or the opt-in high-contrast theme. The choice is
// an accessibility preference of this device, so it lives in localStorage and is mirrored to
// Telegram DeviceStorage (like the offline queue) to survive the WebView clearing its storage.
import { mirrorToDevice, restoreFromDevice } from "./deviceStorage";

export const CONTRAST_KEY = "trix:v2:contrast";
export type Theme = "light" | "dark" | "contrast";

export function readContrast(): boolean {
  try { return localStorage.getItem(CONTRAST_KEY) === "1"; } catch { return false; }
}

/** High contrast wins over Telegram's scheme; null leaves the stylesheet's prefers-color-scheme default. */
export function resolveTheme(contrast: boolean, scheme: "light" | "dark" | undefined): Theme | null {
  return contrast ? "contrast" : scheme ?? null;
}

export function applyTheme(): void {
  const theme = resolveTheme(readContrast(), window.Telegram?.WebApp?.colorScheme);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function setContrast(on: boolean): void {
  try {
    if (on) localStorage.setItem(CONTRAST_KEY, "1");
    else localStorage.removeItem(CONTRAST_KEY);
  } catch { /* storage is optional; the theme still applies for this session */ }
  mirrorToDevice(CONTRAST_KEY);
  applyTheme();
}

/** When the WebView lost the preference but DeviceStorage kept it, put it back and repaint. */
export function restoreContrast(): void {
  void restoreFromDevice(CONTRAST_KEY).then((restored) => { if (restored) applyTheme(); });
}
