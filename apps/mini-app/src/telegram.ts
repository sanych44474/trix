// Thin, version-checked wrappers over the Telegram WebApp features the app uses beyond the basics.
// Every method exists only from some Bot API version on, and older clients still in use throw a
// "WebAppMethodUnsupported" error when an absent one is called -- so each wrapper answers "can I?"
// from isVersionAtLeast first and the UI only offers what the running client supports.

function webApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

function atLeast(version: string): boolean {
  const tg = webApp();
  if (!tg?.initData) return false; // opened outside Telegram (dev/debug): nothing native to call
  try { return tg.isVersionAtLeast?.(version) ?? false; } catch { return false; }
}

export const canUseMainButton = () => atLeast("6.1") && Boolean(webApp()?.MainButton);
export const canShareStory = () => atLeast("7.8") && typeof webApp()?.shareToStory === "function";
export const canAddToHomeScreen = () => atLeast("8.0") && typeof webApp()?.addToHomeScreen === "function";
export const canFullscreen = () => atLeast("8.0") && typeof webApp()?.requestFullscreen === "function";
export const canOpenInvoice = () => atLeast("6.1") && typeof webApp()?.openInvoice === "function";

export function shareToStory(mediaUrl: string, text?: string): void {
  try { webApp()?.shareToStory?.(mediaUrl, text ? { text: text.slice(0, 200) } : undefined); } catch { /* unsupported client */ }
}

export function addToHomeScreen(): void {
  try { webApp()?.addToHomeScreen?.(); } catch { /* unsupported client */ }
}

/** "added" / "missed" / "unknown" / "unsupported" -- resolves "unsupported" off Telegram. */
export function homeScreenStatus(): Promise<"unsupported" | "unknown" | "added" | "missed"> {
  return new Promise((resolve) => {
    const tg = webApp();
    if (!canAddToHomeScreen() || !tg?.checkHomeScreenStatus) { resolve("unsupported"); return; }
    try { tg.checkHomeScreenStatus(resolve); } catch { resolve("unsupported"); }
  });
}

export function isFullscreen(): boolean {
  return Boolean(webApp()?.isFullscreen);
}

export function setFullscreen(on: boolean): void {
  try { if (on) webApp()?.requestFullscreen?.(); else webApp()?.exitFullscreen?.(); } catch { /* unsupported client */ }
}

/** Subscribes to a WebApp event; returns the unsubscribe. */
export function onTelegramEvent(event: string, handler: () => void): () => void {
  const tg = webApp();
  try { tg?.onEvent?.(event, handler); } catch { /* unsupported client */ }
  return () => { try { tg?.offEvent?.(event, handler); } catch { /* unsupported client */ } };
}

export function openInvoice(link: string): Promise<"paid" | "cancelled" | "failed" | "pending"> {
  return new Promise((resolve) => {
    try { webApp()?.openInvoice?.(link, resolve); } catch { resolve("failed"); }
  });
}

/** Telegram's frame (header, background, bottom bar) in the app's own ground colour, so the app
 *  doesn't sit inside a differently coloured strip; called whenever the theme changes. */
export function syncFrameColors(): void {
  const tg = webApp();
  if (!tg?.initData) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return;
  try { if (atLeast("6.9")) tg.setHeaderColor?.(bg); } catch { /* unsupported client */ }
  try { if (atLeast("6.1")) tg.setBackgroundColor?.(bg); } catch { /* unsupported client */ }
  try { if (atLeast("7.10")) tg.setBottomBarColor?.(bg); } catch { /* unsupported client */ }
  // A visible native button was painted with the old theme's accent.
  if (mainButtonVisible) {
    try { tg.MainButton?.setParams({ ...brandButtonColors() }); } catch { /* unsupported client */ }
  }
}

/** Swipe-down closes the Mini App on 7.7+; mid-workout a scroll that starts at the top shouldn't. */
export function setVerticalSwipes(enabled: boolean): void {
  if (!atLeast("7.7")) return;
  try { if (enabled) webApp()?.enableVerticalSwipes?.(); else webApp()?.disableVerticalSwipes?.(); } catch { /* unsupported client */ }
}

/** The brand's primary-button colours for the native bottom button (Telegram's default is the
 *  chat theme's blue): the accent with dark text, or white text where the accent is dark. */
function brandButtonColors(): { color: string; text_color: string } | null {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onAccent = getComputedStyle(document.documentElement).getPropertyValue("--on-accent").trim();
  if (/^#[0-9a-f]{6}$/i.test(onAccent)) return { color: accent, text_color: onAccent };
  return { color: accent, text_color: lum > 0.18 ? "#18241f" : "#ffffff" };
}

export interface MainButtonState {
  text: string;
  active: boolean;
  progress: boolean;
}

/** Shows Telegram's native bottom button with this state and click handler; returns a cleanup
 *  that hides it and detaches the handler. Call again with new state to update it. */
let mainButtonVisible = false;

export function showMainButton(state: MainButtonState, onClick: () => void): () => void {
  const button = webApp()?.MainButton;
  if (!button) return () => {};
  mainButtonVisible = true;
  try {
    button.setParams({ text: state.text, is_active: state.active, is_visible: true, ...brandButtonColors() });
    if (state.progress) button.showProgress(false); else button.hideProgress();
    button.onClick(onClick);
  } catch { /* unsupported client */ }
  return () => {
    mainButtonVisible = false;
    try { button.offClick(onClick); button.hideProgress(); button.setParams({ is_visible: false }); } catch { /* unsupported client */ }
  };
}

/** Opens a URL in the external browser (an OAuth page must not run inside the webview). */
export function openExternal(url: string): void {
  const tg = webApp();
  try { if (tg?.initData && tg.openLink) { tg.openLink(url); return; } } catch { /* fall through */ }
  window.open(url, "_blank", "noopener");
}

/** Telegram's native confirm where the client has it (Bot API 6.2+), the browser's otherwise. */
export function confirmDialog(message: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      try { tg.showConfirm!(message, (ok) => resolve(ok)); } catch { resolve(window.confirm(message)); }
    });
  }
  return Promise.resolve(window.confirm(message));
}
