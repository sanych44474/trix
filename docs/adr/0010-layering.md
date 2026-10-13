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
  | `CURATED` food table and `foodCategory`, from `ai/nutritionDb.ts` | `domain/curatedFoods.ts` (re-exported by `nutritionDb.ts`) |

- Cross-layer imports went from 48 to 32.

## Consequences / next steps

The remaining 32 lines in `KNOWN` are use cases that still live in `bot/` but are shared with the
Mini App. Each one should move to `features/` when it is next touched, then its line comes out of
`KNOWN`:

- **Plan building:** `bot/plan.ts`, `planBuild`, `planView`, `exerciseCatalog`. This is the biggest
  knot, because `webapp/planApi` and `profileApi` call `finalizeOnboardingPlan` / `rebuildPlan`.
- **Onboarding interview:** `bot/onboarding.ts`, used by `obSteps` and the owner report.
- **Owner report:** `bot/ownerReport.ts`, `ownerRows`. These are reporting queries; target
  `features/owner/`.
- **Workout save and guided log:** `bot/workoutSave`, `guidedLog`, used by `webapp/workout.ts`.
- **Smaller ones:** `survey`, `nutritionCmds`, `mealPlanCmds`, `report`, `calendar`, `squad`,
  `support`, `exportData`, `feedbackIntake`, `coach`, `formCheck`, `importCsv`,
  `releaseBroadcast`, `ownerAccess`.

The two remaining `adapters/` → `webapp/` and `adapters/` → `bot/` edges were removed in this
change. No infrastructure module depends on an interface any more.
