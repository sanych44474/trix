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

> Full feature inventory: [`docs/features.md`](docs/features.md).
> Scaling notes and free-tier limits: [`docs/SCALABILITY.md`](docs/SCALABILITY.md).

## Architecture

```
Telegram ──webhook──▶ Worker.fetch ──▶ grammY ──▶ handlers ──▶ AI chain + Cloudflare D1
Mini App ──fetch─────▶ Worker.fetch ──▶ /api/* (initData HMAC auth) ──┘
                      Worker.scheduled (cron, DB-locked) ──▶ reminders / nudges / reports
```

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
| `src/index.ts` | Worker entry: `/webhook`, `/health`, `/api/*`, `/admin/*`, cron `scheduled` |
| `src/bot.ts` | grammY bot: commands, callbacks, routing, onboarding, plan generation, roles |
| `src/bot/router.ts` | Command + callback route tables, bot construction |
| `src/bot/trainer.ts` | Trainer flows: client cards, templates, billing, sessions, program sharing |
| `src/bot/owner.ts` | Owner admin: user cards, moderation, video overrides |
| `src/scheduler.ts` | Cron: reminders, check-ins, weekly digests, trainer digests, owner report |
| `src/webapp/` | Mini App: `client/` static shell fragments + per-screen JSON APIs |
| `src/db/repos.ts` | D1 (SQLite) repository — every query a function over `D1Database` |
| `src/domain/` | **Pure**, unit-tested logic: progression, records, analysis, standards, plan bank |
| `src/ai/` | Orchestrator + provider clients (shared `http.ts`) + prompts + nutrition DB |
| `src/render.ts` | HTML + chart rendering for the chat surface |
| `src/locales/` | `en` / `uk` / `ru` catalogs, `t()` with HTML escaping, `cleanAi()` sanitizer |
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

# 3. Register the webhook + command menu against the deployed Worker
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
| `WORKER_URL` | no | Public origin of the deployed Worker. Enables the Mini App buttons; leave empty in local dev to unlock the `?debugUser=` bypass. |

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
npm test            # node --test (273 unit/integration tests)
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

Worker secrets set with `wrangler secret put` survive deploys, so CI never needs them.

## Security

Never commit `.dev.vars`, API tokens, or database dumps containing real user rows. To report a
vulnerability, see [SECURITY.md](SECURITY.md) — please use a private advisory rather than a
public issue.

## License

[MIT](LICENSE).
