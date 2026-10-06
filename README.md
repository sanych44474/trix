# trix — AI personal trainer as a Telegram bot

[![CI](https://github.com/sanych44474/trix/actions/workflows/ci.yml/badge.svg)](https://github.com/sanych44474/trix/actions/workflows/ci.yml)
[![CodeQL](https://github.com/sanych44474/trix/actions/workflows/codeql.yml/badge.svg)](https://github.com/sanych44474/trix/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A Telegram bot that acts as a strength & nutrition coach. It interviews a new user the way a
real trainer would, generates a tailored training + nutrition plan, pushes the workout on
training days, tracks what was actually done, follows strength progress, logs macros from text
or a meal photo, and answers coaching questions.

Beyond the solo AI path it also supports **real human trainers and their clients**, and an
opt-in **global leaderboard**. Two surfaces share one backend: the Telegram chat itself and a
**Telegram Mini App**. Bilingual UA/EN.

**It runs entirely on free tiers** — Cloudflare Workers + D1 for compute and storage, and an
AI fallback chain that starts at Gemini and degrades gracefully all the way down to
Cloudflare's on-platform Workers AI, which needs no API key at all.

**Landing page:** [sanych44474.github.io/trix](https://sanych44474.github.io/trix/)

## What it can do

**196 functions across 11 areas**, one per line in the
[feature catalog](docs/features.md); what changed in each release is in the
[release notes](docs/release-notes.md). The short version:

| Area | Highlights |
|---|---|
| Training plan (33) | Split around your days, equipment and injuries — and kept inside your equipment; honest starting weights (pick by feel, or from your stated lifts); sets, weights, RPE/RIR, rest, tempo; supersets; self-balancing plans and one-tap fixes; a day swap when muscles aren't recovered; weekly progression, plateau detection, level-ups; cardio counted as load; "not my gym today" |
| Workout logging (30) | Mini App logger with one-tap "as planned", technique pictures and steps, AI form check from a video, swaps it remembers, rest timer with a Telegram push, drafts synced across devices, measured session length, Telegram's native button, Strava import; or log by text / voice in chat |
| Nutrition (14) | Macros from text or a meal photo, Open Food Facts search, adaptive calories, AI meal plan, aisle-sorted shopping list |
| Body & recovery (15) | Weight, measurements, body-fat estimate, goal forecast, water, steps, wellbeing check-in and readiness, progress photos, opt-in cycle tracking |
| Motivation & community (21) | XP, levels, streaks with freezes, 26 badges, weekly quests, a monthly seasonal challenge, a weekly muscle-balance score, records with e1RM charts, leaderboards, challenges, buddy duels, group-chat squads, share to Telegram stories |
| Trainer tools (22) | Invite link, request inbox and waitlist, client cards, per-client plan editor, templates, broadcasts, traffic-light digest, at-risk alerts, schedule and payments |
| Reminders (13) | Timezone-aware and fitted to when you train, evening checklist, weekly digests, a dedicated first-14-days arc |
| Onboarding (12), Mini App (21), Owner (10), Safeguards (5) | Button interview, instant plan; app with an exercise library (750 with pictures), a per-muscle body map, recovery map and 12-week muscle trends, calendar, heatmap, home-screen shortcut, export and voluntary Stars support; owner console with retention by signup week; idempotent saves, GDPR delete |

**Why it matters:** it is a coach, not a log. It writes the program, decides when to add weight,
and messages you first, inside the app you already use. Trainers get the tooling that usually
takes a CRM, a spreadsheet and a messenger. Running it costs nothing, so using it costs nothing.

| | |
|---|---|
| Roles | solo athlete · trainer's client · trainer · owner |
| Surfaces | Telegram chat (45 commands) + Telegram Mini App |
| Languages | Ukrainian, English (~1,700 strings each, parity enforced by the type checker) |
| Backend | 70 typed API operations (OpenAPI 3.1), 83 D1 migrations, ~50k lines of TypeScript |
| Tests | ~1,000 (node:test + Workers runtime), CI on every pull request |
| Cost | $0 — no ads, no subscription |

## Architecture

```
Telegram ──webhook──▶ Worker.fetch ──▶ grammY ──▶ handlers ──▶ AI chain + Cloudflare D1
Mini App ──fetch─────▶ Worker.fetch ──▶ /api/* (initData HMAC auth) ──┘
                      Worker.scheduled (cron, DB-locked) ──▶ reminders / nudges / reports
```

`apps/mini-app` (React + Vite) at `/app-v2` and its versioned REST seam at `/api/v2/*` are the
only Mini App surface now — `v2_*` D1 tables are the source of truth for all ten domains. The
legacy vanilla-JS shell has been retired: `GET /app` is now a tiny static redirect to `/app-v2`
(`scripts/build-webapp.mjs`), not a functional fallback UI. Its source
(`src/webapp/client/*`) and the unversioned `/api/*` routes it used stay in the tree as the
rollback path — restore `build-webapp.mjs`'s previous assembly logic from git history if `/app-v2`
ever needs to be rolled back. See [ADR-0001](docs/adr/0001-v2-seams-and-staged-cutover.md).

User and onboarding state live on the user row in D1 — no KV, no external session store.
Free-text messages are routed by `user.session.mode`; inline keyboards carry their state in
`callback_data`. The Mini App shell is a single static asset served straight from Cloudflare's
edge, so opening the app costs no Worker invocation.

### AI chain

Every provider receives the **same input**, so falling back never loses the user's context.
Non-Gemini providers get the JSON schema injected into the prompt.

| Order | Provider | Used for |
|---|---|---|
| 1 | **Gemini** (`responseSchema`) | plan generation, translation — most reliable structured JSON |
| 2 | **Groq** | conversational kinds, fast JSON, Whisper voice transcription |
| 3 | **OpenRouter** (`:free` models) | text + vision fallback |
| 4 | **Cloudflare Workers AI** | on-platform, no key, text-only |
| 5 | **Ollama Cloud** | text-only last resort |

Each Gemini model in the ladder is a separate quota bucket, so free-tier 429/503 storms fail
over instead of erroring. If every provider is down, the bot says so and preserves the state.

### Source layout

| Path | Responsibility |
|---|---|
| `apps/worker/index.ts` | Cloudflare deploy composition root; exports the Worker and Durable Objects |
| `src/index.ts` | Worker runtime implementation: `/webhook`, `/health`, `/api/*`, `/admin/*`, cron `scheduled` |
| `src/bot.ts` | grammY bot: commands, callbacks, routing, onboarding, plan generation, roles |
| `src/bot/router.ts` | Command + callback route tables, bot construction |
| `src/bot/trainer.ts` | Trainer flows: client cards, templates, program sharing |
| `src/bot/owner.ts` | Owner admin: user cards, moderation, video overrides |
| `src/scheduler.ts` | Cron: reminders, check-ins, weekly digests, trainer digests, owner report |
| `src/webapp/` | Mini App: `client/` static shell fragments + per-screen JSON APIs |
| `apps/mini-app/` | React + Vite v2 Mini App shell and dark sports design system |
| `apps/mini-app/src/train/` | Workout logger screen pieces: exercise card, rest bar, save dock, summary, history, `useSession` (rest timer + session clock) |
| `apps/mini-app/src/logic/` | **Pure**, unit-tested client logic: logger state and draft reconciliation, saved-log hydration, rest timing |
| `src/application/` | Deep application interfaces shared by adapters |
| `src/adapters/d1/` | D1 application adapters and legacy-to-v2 projections |
| `packages/contracts/` | OpenAPI 3.1 contract for `/api/v2/*` |
| `src/db/repos.ts` | D1 (SQLite) repository — every query a function over `D1Database` |
| `src/domain/` | **Pure**, unit-tested logic: progression, records, analysis, standards, plan bank |
| `src/ai/` | Orchestrator + provider clients (shared `http.ts`) + prompts + nutrition DB |
| `src/render.ts` | HTML + chart rendering for the chat surface |
| `src/locales/` | `en` / `uk` catalogs, `t()` with HTML escaping, `cleanAi()` sanitizer |
| `migrations/` | Forward-only D1 migrations |

## Quickstart — run your own bot

Prerequisites: Node 22+, a Cloudflare account (free plan is enough), and a Telegram bot token
from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/sanych44474/trix.git && cd trix
npm install
cp .dev.vars.example .dev.vars      # then fill it in — see Configuration below

# Create your own D1 database and paste the printed id into wrangler.toml
npx wrangler d1 create trix

npx wrangler d1 migrations apply trix --local
npm run dev
curl localhost:8787/health
```

`.dev.vars` is gitignored and overrides `[vars]` from `wrangler.toml` during `wrangler dev`,
so your bot's identity never has to be committed.

### Going live

```bash
# 1. Push the schema and the Worker
npx wrangler d1 migrations apply trix --remote
npm run deploy

# 2. Store secrets in Cloudflare (once each)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_SECRET
# optional: GROQ_API_KEY, OPENROUTER_API_KEY, OLLAMA_API_KEY, YOUTUBE_API_KEY, USDA_FDC_API_KEY

# 3. Register the webhook against the deployed Worker (once per bot). The command menu, profile
#    texts and menu button are applied by the Worker itself after each deploy
#    (src/telegramSetup.ts; bump TELEGRAM_SETUP_VERSION when you change them).
node scripts/setup-telegram.mjs

# 4. Claim the owner role by sending /admin <ADMIN_SECRET> to your bot
```

Then post-deploy smoke-test it: `node scripts/smoke.mjs https://<your-worker>.workers.dev`.

## Configuration

Nothing in this repository identifies a particular deployment — every value below is either a
placeholder in `wrangler.toml` or a secret.

### Deployment identity (`[vars]` in `wrangler.toml`, or `.dev.vars` locally)

| Variable | Required | Purpose |
|---|---|---|
| `BOT_USERNAME` | yes | Your bot's `@username` without the `@`. Builds `t.me/…` invite and share links. |
| `BOT_ID` | no | Numeric bot id. With `BOT_USERNAME` it lets the Worker skip a `getMe` call on every webhook. |
| `BOT_NAME` | no | Display name used in the preset `botInfo`. |
| `WORKER_URL` | no | Public origin of the deployed Worker. Enables the Mini App buttons; leave empty in local dev to hide them (there's no URL yet to link to). |
| `ALLOW_DEBUG_USER` | no | Local-dev-only. Set to `1` in `.dev.vars` to unlock the `?debugUser=` Mini App auth bypass. **Never** set in a deployed environment — it is a full auth bypass, not tied to `WORKER_URL` on purpose so a blank deploy-time variable can't reopen it. |
| `V2_APP_ENABLED` | no | Selects `/app-v2` in bot buttons when set to `1` (the committed default). `0` points buttons at `/app`, which now just redirects straight back to `/app-v2` — the legacy shell it used to serve is retired, so this no longer gives a distinct fallback UI. |

`account_id` is deliberately **not** committed — wrangler reads `CLOUDFLARE_ACCOUNT_ID` from
the environment. `database_id` in `wrangler.toml` is a placeholder you replace with your own.

### Secrets (`wrangler secret put`, mirrored in `.dev.vars` for local dev)

| Secret | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Random string, verified as `X-Telegram-Bot-Api-Secret-Token` |
| `ADMIN_SECRET` | yes | Pass-phrase for `/admin` and the `/admin/*` HTTP routes |
| `GEMINI_API_KEY` | recommended | Comma-separated keys allowed — multiplies the free-tier quota |
| `GROQ_API_KEY` | optional | Groq fallback + Whisper voice transcription |
| `OPENROUTER_API_KEY` | optional | `:free` model fallback (text + vision) |
| `OLLAMA_API_KEY` | optional | Ollama Cloud text-only fallback |
| `YOUTUBE_API_KEY` | optional | Exercise-technique shorts (cache-first) |
| `USDA_FDC_API_KEY` | optional | Raises the nutrition-lookup limit above the shared `DEMO_KEY` |
| `EXERCISES_API_KEY` | optional | Used only by `scripts/seed-exercises.mjs`, never at runtime |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | optional | Strava cardio import. Create an API app at strava.com/settings/api and set its **Authorization Callback Domain** to your Worker's domain (the callback is `<WORKER_URL>/strava/callback`). Unset = the Strava card is hidden. |

Telegram Stars support needs no secret, but the webhook must receive `pre_checkout_query`
updates: re-run `node scripts/setup-telegram.mjs` once after deploying this version.

D1 and Workers AI need no secret — they are bound via `[[d1_databases]]` and `[ai]`.

Model choices (`GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, fallback ladders, …) are
non-secret `[vars]` in `wrangler.toml`; adjust them without touching code.

### Cloudflare API token permissions

For `wrangler deploy` + D1 against `*.workers.dev`:

- Account → **Workers Scripts: Edit**
- Account → **D1: Edit**
- Account → **Workers AI: Edit**
- Account → **Account Settings: Read**
- User → **User Details: Read**
- *(optional)* Account → **Workers Tail: Read** — for `wrangler tail`

## Development

```bash
npm run dev         # wrangler dev (.dev.vars + local D1)
npm run typecheck   # tsc --noEmit
npm run typecheck:webapp
npm run build:webapp:v2
npm test            # node --test (~930 unit/integration tests)
npm run test:workers # vitest in the Workers runtime (workerd)
npm run deploy      # build the Mini App shell + wrangler deploy
npm run tail        # stream live Worker logs
```

Both `npm run typecheck` and `npm test` must be green before anything ships — CI enforces it on
every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions that are easy to
trip over (bilingual catalog parity, migration rules, AI text sanitizing).

### Deployment pipeline

Pushing to `main` runs CI, then queues a deploy that waits for a manual approval in the
`production` GitHub Environment before it touches Cloudflare. Configure it with:

- **Environment secrets** (`production`): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`
- **Repository variables**: `WORKER_URL`, `BOT_USERNAME`, and optionally `BOT_ID`, `BOT_NAME`

`ALLOW_DEBUG_USER` is deliberately **not** among the deploy-time variables above: the committed
`wrangler.toml` default (`"0"`) ships to production unchanged, and it is only ever set to `"1"` in
a gitignored local `.dev.vars`.

Worker secrets set with `wrangler secret put` survive deploys, so CI never needs them.

## Security

Never commit `.dev.vars`, API tokens, or database dumps containing real user rows. To report a
vulnerability, see [SECURITY.md](SECURITY.md) — please use a private advisory rather than a
public issue.

## License

[MIT](LICENSE).
