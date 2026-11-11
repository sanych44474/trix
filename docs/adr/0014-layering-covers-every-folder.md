# ADR-0014: the layering rules cover every folder, and `src/` has no loose modules

- Status: accepted
- Date: 2026-11-10
- Extends [ADR-0010](0010-layering.md). Retires the `src/application` seam of
  [ADR-0001](0001-v2-seams-and-staged-cutover.md).

## Context

ADR-0010 set the layers and `test/architecture.test.ts` enforced them, but the test knew fewer
folders than the code has:

- It had rules for `domain/`, `adapters/`, `ai/`, `features/`, `schedulerJobs/`, `knowledge/` and
  `webapp/` only. Imports that start in `src/*.ts`, `durable/`, `render/`, `notify/`,
  `application/` or `contracts/` were never checked.
- `ai/` was checked against `bot/` and `webapp/`, although ADR-0010 also forbids `features/`.
- `domain/` was allowed to import any file in `src/`. Eleven of the seventeen files there did
  I/O (D1, `fetch`, Telegram). Nothing in `domain/` imported them, but nothing stopped it either,
  and the Mini App bundles `domain/` modules directly.
- Those eleven files had no layer. `src/notify.ts` and the folder `src/notify/` were two different
  modules with one name.
- `src/application/dashboard.ts` was a 16-line interface with one adapter. Its only method
  forwarded to `buildDashboardPayload`, and two of the three callers already called that function
  directly.

## Decision

**1. Every folder under `src/` belongs to a layer.** A folder with no rule fails the test.

<table>
<tr><th>Layer</th><th>Folders</th><th>May import</th></tr>
<tr><td>Shared root</td><td><code>types.ts</code>, <code>log.ts</code>, <code>releaseNotes.ts</code>, <code>appVersion.ts</code></td><td><code>domain/</code>, <code>locales/</code>, each other</td></tr>
<tr><td>Pure</td><td><code>domain/</code>, <code>locales/</code>, <code>contracts/</code>, <code>render/</code></td><td>Only what is listed for the folder (below), plus <code>types.ts</code> and <code>releaseNotes.ts</code></td></tr>
<tr><td>Infrastructure</td><td><code>adapters/</code>, <code>ai/</code></td><td>Anything except the application and interface layers</td></tr>
<tr><td>Application</td><td><code>features/</code>, <code>notify/</code>, <code>knowledge/</code>, <code>schedulerJobs/</code></td><td>Anything except the interface layer</td></tr>
<tr><td>Interfaces</td><td><code>bot/</code>, <code>webapp/</code>, <code>durable/</code>, <code>index.ts</code>, <code>scheduler.ts</code></td><td><code>bot/</code> and <code>webapp/</code> never import each other; <code>durable/</code> imports neither</td></tr>
</table>

The pure layers are an allow-list, so a new folder is closed to them until someone adds it:

<table>
<tr><th>Folder</th><th>May import</th></tr>
<tr><td><code>domain/</code></td><td><code>domain/</code>, <code>locales/</code></td></tr>
<tr><td><code>render/</code></td><td><code>render/</code>, <code>domain/</code>, <code>locales/</code></td></tr>
<tr><td><code>locales/</code>, <code>contracts/</code></td><td>themselves</td></tr>
</table>

`index.ts` is the composition root and may import anything. `index.ts` and `scheduler.ts` are
imported at runtime only by each other and by `durable/` (the user Durable Object runs the cron's
per-user pass). Type-only imports are not checked, as before.

**2. `src/` holds only the two entries and the four shared modules.** A new `src/*.ts` file fails
the test. The loose modules moved to their layers:

<table>
<tr><th>From</th><th>To</th></tr>
<tr><td><code>render.ts</code></td><td><code>render/telegramText.ts</code></td></tr>
<tr><td><code>notify.ts</code></td><td><code>notify/notify.ts</code></td></tr>
<tr><td><code>schedulerOutbox.ts</code></td><td><code>notify/outbox.ts</code></td></tr>
<tr><td><code>youtube.ts</code></td><td><code>adapters/youtube/youtube.ts</code></td></tr>
<tr><td><code>normalizeVideoKey</code>, from <code>youtube.ts</code></td><td><code>domain/videoKey.ts</code> (pure, and <code>render/</code> needs it)</td></tr>
<tr><td><code>telegramSetup.ts</code></td><td><code>adapters/telegram/setup.ts</code></td></tr>
<tr><td><code>limits.ts</code></td><td><code>adapters/rateLimit/limits.ts</code></td></tr>
<tr><td><code>staleDrafts.ts</code></td><td><code>features/plan/staleDrafts.ts</code></td></tr>
<tr><td><code>questClose.ts</code></td><td><code>features/gamification/questClose.ts</code></td></tr>
<tr><td><code>exerciseMuscleLearning.ts</code></td><td><code>features/exercise/muscleLearning.ts</code></td></tr>
<tr><td><code>dailyMetricsRollup.ts</code></td><td><code>schedulerJobs/dailyMetricsRollup.ts</code></td></tr>
<tr><td><code>aiModelWatch.ts</code></td><td><code>schedulerJobs/aiModelWatch.ts</code></td></tr>
</table>

These are moves. No function body changed.

**3. `src/application/` is removed.** The Mini App dashboard route calls `buildDashboardPayload`
(`adapters/d1/dashboardReader.ts`) directly, as `index.ts` and `webapp/clientCard.ts` already did.
A seam with one adapter and a forwarding body hid nothing. If a second dashboard source ever
appears, introduce the interface then.

## Known violations

The wider rules found two existing edges. They are listed in `KNOWN` in the test, which is a
ratchet as in ADR-0010: a new violation fails, and so does a listed one that has been fixed.

<table>
<tr><th>Import</th><th>Why it is wrong</th></tr>
<tr><td><code>adapters/telegram/keyboards.ts</code> → <code>notify/appLinks</code></td><td>Infrastructure reaches the application layer for <code>dashboardUrl</code></td></tr>
<tr><td><code>schedulerJobs/global.ts</code> → <code>durable/dryrunLog</code></td><td>A shared job reaches an interface folder to prune the scheduler dry-run log</td></tr>
</table>

## Not changed

- `adapters/d1` and `ai/` import each other (`ai/index.ts` → `adapters/d1/v2AiTelemetry`,
  `adapters/d1/v2Admin.ts` → `ai/limiter`). Both are infrastructure, so the rule allows it.
- SQL outside `adapters/` is not checked. The sign-in code in `webapp/providerAuth.ts`,
  `webapp/emailAuth.ts` and `webapp/appSessions.ts` still queries the `v2_auth_*` tables itself.

## Consequences

- "Where does this module go" has an answer for every file, and the test gives it.
- `domain/` cannot gain an I/O dependency by importing a root file, which keeps the modules the
  Mini App bundles safe to bundle.
- Adding a top-level folder under `src/` now needs a line in `violates()`.
