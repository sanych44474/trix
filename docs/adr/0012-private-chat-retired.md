# ADR-0012: the private chat is retired; the bot keeps only what the app still needs

- Status: accepted
- Date: 2026-11-04
- Supersedes [ADR-0007](0007-photo-of-food-stays-in-the-bot.md)

## Context

Since `launcherGate` (`src/bot/launcher.ts`) every private-chat update from anyone but the owner
is answered with the Open-app button. The athlete and trainer flows in `src/bot/` (logging,
plan editing, nutrition, progress, settings, coach, check-in, calendar, records, injury,
vacation, warm-up, menus, photo and voice input, the trainer chat card and wizard, ~5-10k lines
including the grammY-bound `features/` modules) can no longer be reached by users. They only
run for the owner, and in local dev without a Mini App URL.

The cost of keeping them is real:

- Every rule they implement has to stay right in code nobody exercises. The architecture review
  found such rules diverging (the training-day rule decided two ways; the rest-day macros
  picked in four places).
- ADR-0010 layering is satisfied by file moves, but 18 `features/` modules still take a grammY
  `MyContext` because they are chat UI.
- ADR-0007 ("photo-of-food logging stays in the bot") no longer holds: a non-owner's photo gets
  the launcher, and `POST /api/v2/media/meal-photo` logs a meal photo in the app.

## Decision

The private chat is retired for everyone, the owner included: athlete and trainer work happens in
the Mini App and the Android app. The bot keeps exactly what those clients or the owner still
depend on, and the rest is removed.

What stays:

| Kept | Why |
| --- | --- |
| Middleware, `launcherGate`, the Open-app reply | The entry point for every chat update |
| `/start` and its pairing payloads (`tr_`, `trp_`, `ref_`, `buddy_`, `sq_`, `login_`) | Trainer, buddy, referral and squad deep links, and the native app's Telegram sign-in |
| `tglogin:` callbacks | The app's Telegram sign-in confirm step |
| Payments (`pre_checkout_query`, `successful_payment`, `/support`, `/paysupport`) | Telegram Stars |
| Price poll (`pp:`, `poll_price` / `poll_wish` text) | The owner's poll, answered in the chat |
| Inactive-user ask (`inact:`, `inact_feedback` text), `/cleanup`, `/askinactive` | The owner's cleanup flow |
| Sharing consent after pairing (`share:tog:`, `share:skip`) | Sent by the bot, answered in the chat |
| Group chats (squads) | Squad mode lives in groups |
| Owner tools (`/admin`, `/ownerreport`, `/users`, `/announce`, `/pricepoll`, `/whatsnew`, `/refreshvideos`, `/setvideo`, and their `orep:` / `ou:` / `trainer:approve:` / `trainer:reject:` / `clean:del:` callbacks) | The owner runs the service from the chat |
| `onboarding.pingIncompleteOnboarding` | The scheduler's nudge, which links to app onboarding |

Everything else in the private chat is removed, together with its tests, and any module
that is then unreachable from `src/index.ts`.

## Consequences

- One implementation per rule: the shared use cases keep only their app and scheduler callers.
- Local development without a Mini App URL no longer has a chat fallback for athlete flows. Use
  the Mini App (`npm run dev`).
- Notifications that fell back to chat callbacks when no Mini App URL was configured (`appMarkup`
  without `WORKER_URL`) show no button in that setup. Production always has the URL.
- The removal runs in slices, each green on its own: router registrations first, then the
  callback and text route tables, then the modules the import graph shows unreachable.
