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

export interface MainButtonState {
  text: string;
  active: boolean;
  progress: boolean;
}

/** Shows Telegram's native bottom button with this state and click handler; returns a cleanup
 *  that hides it and detaches the handler. Call again with new state to update it. */
export function showMainButton(state: MainButtonState, onClick: () => void): () => void {
  const button = webApp()?.MainButton;
  if (!button) return () => {};
  try {
    button.setParams({ text: state.text, is_active: state.active, is_visible: true });
    if (state.progress) button.showProgress(false); else button.hideProgress();
    button.onClick(onClick);
  } catch { /* unsupported client */ }
  return () => {
    try { button.offClick(onClick); button.hideProgress(); button.setParams({ is_visible: false }); } catch { /* unsupported client */ }
  };
}
