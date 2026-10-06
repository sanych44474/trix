// Telegram's native draft (Bot API sendMessageDraft) while an AI job runs. Empty text shows the
// "Thinking…" placeholder; once the model starts answering, update() streams the text so far
// into the same draft, so the reply grows in the chat as it is generated. A draft lives ~30 s,
// so it is refreshed every 20 s; the bot's real message replaces it. Updates are throttled
// (Telegram rate-limits edits), and where drafts aren't available (an old client, a non-private
// chat, an API error) it falls back to refreshing the typing action.
import type { MyContext } from "./context";

const DRAFT_REFRESH_MS = 20_000;
const TYPING_REFRESH_MS = 4_500;
const STREAM_INTERVAL_MS = 700; // at most ~1.4 draft updates a second
const MAX_MS = 120_000; // never outlive a hung job
const MAX_LEN = 4000;

export interface Thinking {
  update(text: string): void;
  stop(): void;
}

const NOOP: Thinking = { update() {}, stop() {} };

export function startThinking(ctx: MyContext): Thinking {
  const chatId = ctx.chat?.id;
  if (!chatId || ctx.chat?.type !== "private") return NOOP;
  const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);
  let useDraft = true;
  let stopped = false;
  let text = ""; // latest text to show ("" = Thinking… placeholder)
  let shown: string | null = null;
  let lastSent = 0;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | null = null;
  const started = Date.now();

  const send = async (force = false) => {
    if (stopped || inflight) return;
    if (!force && shown === text) return;
    const body = text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text;
    inflight = (async () => {
      if (useDraft) {
        try { await ctx.api.sendMessageDraft(chatId, draftId, body); shown = text; } catch { useDraft = false; }
      }
      if (!useDraft) {
        try { await ctx.api.sendChatAction(chatId, "typing"); } catch { /* best effort */ }
      }
      lastSent = Date.now();
    })();
    await inflight;
    inflight = null;
  };

  const tick = async () => {
    if (stopped) return;
    await send(true);
    if (!stopped && Date.now() - started < MAX_MS) refresh = setTimeout(() => void tick(), useDraft ? DRAFT_REFRESH_MS : TYPING_REFRESH_MS);
  };
  void tick();

  return {
    update(next: string) {
      if (stopped || !useDraft) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === text) return;
      text = trimmed;
      if (pending) return;
      const wait = Math.max(0, STREAM_INTERVAL_MS - (Date.now() - lastSent));
      pending = setTimeout(() => { pending = undefined; void send(); }, wait);
    },
    stop() {
      stopped = true;
      if (refresh) clearTimeout(refresh);
      if (pending) clearTimeout(pending);
    },
  };
}
