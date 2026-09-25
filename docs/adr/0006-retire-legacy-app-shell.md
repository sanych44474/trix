# ADR-0006: retire the legacy `/app` vanilla-JS Mini App shell

- Status: accepted
- Date: 2026-09-19

## Context

ADR-0001 kept the legacy vanilla-JS Mini App (`GET /app`, assembled from `src/webapp/client/*`
by `scripts/build-webapp.mjs`) as the rollback path while the React Mini App (`/app-v2`) staged
in. `V2_APP_ENABLED=1` has been the committed default since the v2 cutover completed — every real
user has been on `/app-v2` for some time.

Despite that, a scheduler-built reminder link (`src/scheduler.ts`'s `appView()` helper, used by
three reminder-button call sites) still hardcoded `${env.WORKER_URL}/app?...`, ignoring
`V2_APP_ENABLED` entirely — a user tapping certain push-notification buttons landed on the old UI
regardless of the cohort they were actually in. Every OTHER link-building site
(`src/bot.ts`'s `dashboardUrl()`, `src/bot/keyboards.ts`, `scripts/setup-telegram.mjs`) already
read `V2_APP_ENABLED` correctly; this was the one place that didn't.

## Decision

Fixed the scheduler link (now derives the path the same way `router.ts` does, computed inline
rather than via `bot.ts`'s `APP_PATH` module binding — that binding is only ever set by the
webhook path's `createBot`/`router.ts` call, which the cron trigger reaching `scheduler.ts` never
runs, so it could read stale/default depending on isolate reuse).

Beyond fixing that one broken link, retired the legacy shell itself: `scripts/build-webapp.mjs`
no longer assembles `src/webapp/client/*` into a functional Mini App — it emits a tiny static
redirect to `/app-v2` (preserving the query string, since `App.tsx`'s `viewFromLocation()` reads
the same `view`/`startapp` params the legacy shell used, with the same alias table). This means:

- Any surviving old link, bookmark, or stale cached notification still lands the user in a working
  app instead of a dead or confusing page.
- `V2_APP_ENABLED=0` no longer provides a distinct fallback UI — both settings now point at
  `/app-v2` either directly or via one redirect hop. README's Configuration table is updated to
  say so plainly rather than implying a working legacy fallback still exists.
- `src/webapp/client/*` and the unversioned `/api/*` routes it called are **not deleted** — they
  stay in the tree as the actual rollback path. If `/app-v2` ever needs to be rolled back,
  restore `build-webapp.mjs`'s previous assembly logic from git history (this commit), not from
  scratch.

## Amendment, 2026-09-22 — the source is deleted, the routes get a date

The clause above was self-defeating: it named **git history** as the rollback mechanism, and then
kept 269 KB across 23 files in the working tree as well. Git history provides that rollback whether
or not the files are also checked out, so keeping them bought nothing and cost a permanently
confusing second copy of a retired UI.

`src/webapp/client/*` is therefore **deleted**. Verified dead before removing: `build-webapp.mjs`
stopped assembling it (it emits a 324-byte redirect stub), nothing under `src/`, `apps/`,
`scripts/` or `test/` imports it, and `npm run typecheck` plus the build are unaffected. Restoring
it means `git checkout <this ADR's commit>^ -- src/webapp/client`, which is the same operation the
original clause described.

The unversioned `/api/*` routes in `src/index.ts` are a different risk and are **kept for now**:
they are still publicly served, and a webview that loaded the legacy bundle before the cutover and
has never reloaded would still call them. That population shrinks to zero on its own.

**Expiry: remove the unversioned `/api/*` routes after 2026-12-31**, unless request logs still show
traffic on them. That is a real date rather than "later", which is what let this sit. The handlers
themselves stay regardless — `/api/v2/*` dispatches to them internally by rewriting the pathname
(`src/webapp/v2Api.ts`), so only the public route table entries go.

## Consequences

- One less place for a `V2_APP_ENABLED`-unaware hardcoded `/app` to silently reappear: the
  redirect page means even a future oversight like the scheduler one just found would only cost
  users one extra hop, not land them on genuinely different (and increasingly unmaintained) UI
  code.
- `public/_headers`' CSP for `/app`/`/app.html` was narrowed to match what a same-origin redirect
  page actually needs (no more Telegram SDK script/font allowances, which the legacy shell needed
  and the redirect page does not) and its cache lifetime shortened to `no-cache` so a future change
  to this page propagates immediately rather than sitting behind a 24h client cache.
