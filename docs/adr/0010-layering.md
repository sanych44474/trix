# ADR-0010: layering rules, enforced by a test

- Status: accepted
- Date: 2026-10-13
- Builds on [ADR-0001](0001-v2-seams-and-staged-cutover.md) and [ADR-0003](0003-no-packages-domain-split.md)

## Context

The Worker serves two user interfaces, the Telegram bot (`src/bot/`) and the Mini App API
(`src/webapp/`), plus the cron (`src/scheduler.ts`, `src/schedulerJobs/`). Over time the Mini App
and the shared feature code started importing straight from `bot/`, for links, keyboards, plan
building and onboarding helpers. The result was 48 cross-layer imports, and code that "belongs to
the bot" that the Mini App could not run without. Telegram was also called by hand-written
`fetch` in 14 files: each built a URL containing the bot token and handled failures its own way.

## Decision

Layers, from the inside out. A layer may import its own folder and anything **inside** it, never
outward:

| Layer | Folder | May not import |
|---|---|---|
| Domain (pure rules, data, calculations) | `domain/` | anything but `domain/`, `locales/`, the root `types.ts` / `releaseNotes.ts` |
| Infrastructure (D1, R2, Telegram, AI) | `adapters/`, `ai/` | `bot/`, `webapp/`, `features/` |
| Application (shared use cases, notifications) | `features/`, `notify/`, `knowledge/`, `schedulerJobs/` | `bot/` |
| Interfaces | `bot/`, `webapp/`, `index.ts`, `scheduler.ts` | each other (`webapp/` → `bot/` is the case that matters) |

Telegram transport has one home: `adapters/telegram/rawApi.ts` (`telegramCall` throws on a
refusal, `telegramTry` / `sendBestEffort` / `telegramUpload` never throw, `fetchTelegramFile`).
grammY's `ctx.api` stays the adapter inside bot handlers.

`test/architecture.test.ts` enforces both rules:
- **Layering:** imports that are not type-only are checked against the table. The violations
  that existed when the rule was introduced are listed in `KNOWN`, and that list is a ratchet. A
  new violation fails the test, and so does a listed violation that has since been fixed, so the
  list can only shrink.
- **Transport:** only `rawApi.ts` may contain `api.telegram.org`.

## What moved in this change

- 14 hand-written Telegram calls now go through `rawApi`. Behaviour is unchanged: calls that
  silently ignored an HTTP refusal now use the non-throwing helpers. The release broadcast
  detects "blocked the bot" (403) from the typed error instead of the HTTP status.
- Files moved to the layer they belong to:

  | From | To |
  |---|---|
  | `bot/links.ts` | `notify/links.ts` |
  | `bot/appLinks.ts` | `notify/appLinks.ts` |
  | `bot/onboardingApp.ts` | `notify/onboardingApp.ts` |
  | `bot/keyboards.ts` | `adapters/telegram/keyboards.ts` |
  | `bot/telegramFiles.ts` | `adapters/telegram/files.ts` |
  | `bot/aiDefer.ts` | `features/aiDefer.ts` |
  | `webapp/photoStorage.ts` | `adapters/r2/photoStorage.ts` |
  | `webapp/dashboard.ts` | `domain/dashboardPayload.ts` (pure assembly) |
  | `CURATED` food table and `foodCategory`, from `ai/nutritionDb.ts` | `domain/curatedFoods.ts` |

- Second pass: the plan use cases (`features/plan/planService.ts`: interview retry,
  `finalizeOnboardingPlan`, `rebuildPlan`) and `planBuild`; the onboarding questions
  (`features/onboarding/questions.ts`); the owner report and release broadcast (`features/owner/`);
  and the shared, chat-free functions of `feedbackIntake`, `support`, `squad`, `importCsv`,
  `formCheck`, `guidedLog`, `coach`, `mealPlanCmds` and `workoutSave` (in `features/feedback`,
  `support`, `squad`, `workout`, `coach`, `nutrition`). `localCutoff` moved to `domain/localTime.ts`.
- Cross-layer imports went from 48 to 13.

- Third pass: the last 13 went. Moved out of `bot/`: the evening survey checklist
  (`features/survey/eveningSurvey.ts`), report lines and body dynamics (`features/report/`), the
  data export builders (`features/export/`), exercise catalog use cases and plan-name
  localization (`features/exercise/catalog.ts`), exercise videos for plan days
  (`features/plan/exerciseVideos.ts`), sending onboarding steps (`features/onboarding/sendStep.ts`),
  `isOwner` (`features/owner/ownerAccess.ts`), and the pure helpers `weekdayOf`, `cleanFoodName`
  and the injury area labels (`domain/`). `KNOWN` is now empty.
- Clean-up: the temporary re-exports left behind by the moves, and the `src/bot.ts` barrel, are
  gone. Every import names the module that declares the symbol, so "where does this live" has
  one answer. The only barrels left are `ai/prompts.ts` (read as the `P` namespace) and
  `index.ts` (the Worker entry, which must export the Durable Object classes).

## Consequences

No module outside the interfaces imports `bot/` or `webapp/`, and no infrastructure or domain
module depends on anything above it. The baseline is empty, so any new cross-layer import fails
the test; put shared code in `features/` (or `domain/` when it is pure) instead.
