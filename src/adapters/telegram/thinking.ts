// Telegram's native "Thinking…" draft (Bot API sendMessageDraft with empty text) while an AI job
// runs: the user sees the bot composing in the chat itself, like the big assistants, instead of a
// 5-second "typing…" that goes quiet during a 15-second model call. A draft lives ~30 s, so it is
// refreshed every 20 s; the bot's real message replaces it. Where drafts aren't available (an old
// client, a non-private chat, an API error) it falls back to refreshing the typing action.
import type { MyContext } from "./context";

const DRAFT_REFRESH_MS = 20_000;
const TYPING_REFRESH_MS = 4_500;
const MAX_MS = 120_000; // never outlive a hung job

export function startThinking(ctx: MyContext): () => void {
  const chatId = ctx.chat?.id;
  if (!chatId || ctx.chat?.type !== "private") return () => {};
  const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);
  let useDraft = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  const tick = async () => {
    if (stopped) return;
    if (useDraft) {
      try { await ctx.api.sendMessageDraft(chatId, draftId, ""); } catch { useDraft = false; }
    }
    if (!useDraft) {
      try { await ctx.api.sendChatAction(chatId, "typing"); } catch { /* best effort */ }
    }
    if (!stopped && Date.now() - started < MAX_MS) timer = setTimeout(() => void tick(), useDraft ? DRAFT_REFRESH_MS : TYPING_REFRESH_MS);
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
