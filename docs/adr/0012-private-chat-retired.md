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

## Progress

- **Slice 1** (PR #123, commit `bf29ff8`): the router registers only the kept handlers, the
  callback table keeps 21 exact and 11 prefix routes, and typed text routes only for the kept
  modes. 26 unreachable modules were deleted.
- **Slice 2** (PR #123):
  - `/start` has no chat fallback. After the pairing payloads it sends the Open-app button.
    Without an app URL (a dev bot) it says the app is not set up (`launch_no_app`) instead of
    starting the chat interview, menus or the next-best-action card. `prog_` links open the
    app's library.
  - Pairing through `tr_` / `trp_` no longer falls back to the chat questionnaire. A trainer who
    opens a client invite link is told it is not for them instead of getting the chat trainer
    menu.
  - The modules that became unreachable were deleted: plan view and edit, today edit, exercise
    catalog, kit fit, reorder, nutrition and progress commands, the chat workout save, the next
    best action, plan generation in chat, and the trainer's chat comms, interview and wizard.
    The chat parts of the client card, program sharing and trainer modules went with them. What
    remains of those files serves the app, the scheduler or the owner tools.
  - The owner's view of a user's plan (`ou:<id>:edit`) is read-only. Its day buttons (swap, add,
    delete, reorder, weight, sets, warm-up, video) had routed nowhere since slice 1, so they were
    removed. Plans are edited in the app: the owner opens any user's plan from the roster's Plan
    button (Mini App), and `/api/v2/plan?clientId=` accepts the owner for any account.
  - 1,242 locale keys that nothing used any more were removed from `en.ts` and `uk.ts`, shrinking
    the bot strings from 299 KB to 116 KB in the Worker bundle.
- **Kept, then wired into the app:** `src/domain/safety.ts` (injury conflict checks) lost its only
  caller, the chat's catalog swap. It was kept instead of deleted, and the app now uses it: the
  shared plan editor refuses a swap or add that loads an active injury directly (409
  `injury:<area>`), and the in-session swap list leaves such exercises out.
