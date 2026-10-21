// A notification's buttons, for the native app's push. Telegram messages carry them as an inline
// keyboard whose buttons open the Mini App at a screen (?view=, notify/appKeyboard.ts). The push
// keeps the screens: tapping the notification opens the first one, and up to two buttons become
// notification actions. Pure; test/push.test.ts.

const VIEWS = new Set(["today", "train", "plan", "fuel", "progress", "more", "settings", "library", "inbox", "coach", "role", "onboarding"]);
const MAX_ACTIONS = 2;

export interface PushAction { label: string; view: string }

function viewOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const view = new URL(url).searchParams.get("view");
    return view && VIEWS.has(view) ? view : null;
  } catch {
    return null;
  }
}

/** The screens a Telegram message's buttons open (first = where a tap on the notification goes). */
export function pushActions(extra: unknown): { view?: string; actions: PushAction[] } {
  const rows = (extra as { reply_markup?: { inline_keyboard?: unknown } } | undefined)?.reply_markup?.inline_keyboard;
  const actions: PushAction[] = [];
  if (Array.isArray(rows)) {
    for (const button of rows.flat()) {
      const b = button as { text?: unknown; url?: unknown; web_app?: { url?: unknown } };
      const view = viewOf(b.web_app?.url) ?? viewOf(b.url);
      const label = typeof b.text === "string" ? b.text.trim().slice(0, 40) : "";
      if (view && label && !actions.some((a) => a.view === view)) actions.push({ label, view });
    }
  }
  return { ...(actions[0] ? { view: actions[0].view } : {}), actions: actions.slice(0, MAX_ACTIONS) };
}
