// Whether a focused element raises the on-screen keyboard. While one does, fixed bottom bars and
// Telegram's MainButton must hide (apps/mini-app/CLAUDE.md), or they sit over what is being typed.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "submit"]);

export function isTextEntry(el: { tagName?: string; type?: string } | null | undefined): boolean {
  if (!el?.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase()));
}
