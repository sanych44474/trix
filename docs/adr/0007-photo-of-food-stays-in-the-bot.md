# ADR-0007: photo-of-food logging stays in the bot

- Status: accepted
- Date: 2026-09-22

## Context

`docs/feature-audit-v2.md` has listed "photo-of-food logging" as a Mini App long-tail gap since
the v2 cutover, with the note "no existing mutation/route to build on yet". That note is now out
of date, which is why this needs deciding rather than carrying forward:

- The Mini App **does** upload images. `POST /api/v2/photo` (`handlePhotoUpload`,
  `src/webapp/miscApi.ts`) takes a progress photo from the webview, forwards it to Telegram's
  `sendPhoto`, and stores the returned `file_id`. So the "there is no upload path" half of the
  original reasoning is false.
- `docs/miniapp-migration.md`'s principles table says media flows stay in the bot because "meal
  photos and voice input ride Telegram's media APIs (file download, captions, transcription
  confirm step)". The progress-photo route shows that an upload, taken alone, is not the
  obstacle.

So the question is no longer "can we?" but "is the app a better place for this than the chat?".

## Decision

Photo-of-food logging stays bot-only. `docs/feature-audit-v2.md` stops listing it as a gap and
points here instead.

The reason is the **confirm loop**, not the upload. The bot flow (`handlePhotoMeal`) is: user
sends a photo, often with a caption ("chicken and rice, big portion"), the AI returns an
estimate, and the user corrects it conversationally until it is right. That correction step is
the part that decides whether the logged macros are any good, and chat is genuinely the better
medium for it — the user already has the keyboard open, the photo is in the scrollback as
context, and a follow-up message is cheaper than re-entering a form.

Rebuilding that in the webview means rebuilding the conversation, not the upload: a photo
picker, an estimate screen, a per-item correction UI, and a re-estimate round trip. That is a
materially larger surface than `POST /api/v2/photo` for a flow the bot already does well, and it
would sit next to the AI quick-log the `Fuel` screen already has (type "chicken and rice" and get
the same estimator without a photo at all), which covers most of the same need with one field.

## Consequences

- The Mini App's nutrition surface stays: totals, meals, AI quick-log by text, food search,
  barcode, measured portions, recent re-add, meal-plan editing. A user who wants to log from a
  photo sends it to the chat, which is one tap away from the app.
- This is not a resourcing excuse to revisit when convenient: the reasoning is about which
  medium suits an iterative correction loop. **If that changes — for example if the estimator
  gets good enough that correction is rare — this decision should be reopened explicitly**,
  because the cost argument is downstream of the correction step existing at all.
- The related claim in `docs/miniapp-migration.md` ("media flows stay in the bot ... the webapp
  gets no equivalent for free") is now too strong, since progress photos do upload from the app.
  The accurate statement is narrower and is this ADR: *photo flows whose value is in a
  conversational confirm step* stay in the bot.
- Voice input is untouched by this decision and remains bot-only for its own reasons
  (transcription confirm step, Telegram's media APIs).
