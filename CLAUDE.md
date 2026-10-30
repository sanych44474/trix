# CLAUDE.md

Hack Limits (repo `trix`): an AI training and nutrition coach. Three clients share one backend:
- Telegram bot: `src/bot/`.
- Telegram Mini App: `apps/mini-app/`, Preact + Vite.
- Native Android app: `mobile/`, Kotlin Multiplatform + Compose.

Backend: a single Cloudflare Worker (`src/`, TypeScript).
- Storage: D1 (SQLite), R2, Durable Objects (per-user scheduler), Queues (broadcasts).
- AI: provider fallback in `src/ai/`.

User-facing text is Ukrainian and English. The owner writes in Ukrainian or Russian: answer in their language.

## Checks before every push
```bash
npx tsc --noEmit          # Worker typecheck
npm run typecheck:webapp  # Mini App typecheck
npm run lint              # Biome, warnings are errors
npm test                  # node:test, ~1 min in CI, ~6 min on a laptop
npm run test:workers      # vitest in the Workers runtime (real D1)
npm run build:webapp:all  # when apps/mini-app or src/webapp changed
```
Android has no SDK here: CI's "Mobile" workflow is the check (see `mobile/CLAUDE.md`).
**Every change is covered by tests (owner's standing rule).** New code ships with tests, and a bug fix adds a test that fails before the fix (show it failing).
- Test the path production takes. In a private chat every bot update first passes `launcherGate` (`src/bot/launcher.ts`), which answers everything except the owner with the Open-app button. A bot flow that non-owners answer in the chat (buttons or typed replies) needs a test through the gate with an app URL set (`setAppUrl`). Calling its handlers directly hid that the price poll worked only for the owner.

## Architecture (ADR-0010, enforced by `test/architecture.test.ts`)
- Layers, inside out:
  - `domain/`: pure rules and math.
  - `adapters/`, `ai/`: infrastructure.
  - `features/`, `notify/`, `knowledge/`, `schedulerJobs/`: shared use cases.
  - `bot/`, `webapp/`, `index.ts`, `scheduler.ts`: interfaces.
- Never import outward. `webapp/` never imports `bot/`.
- Only `src/adapters/telegram/rawApi.ts` may contain the Bot API host, because the URL embeds the token.
- No `export … from` re-export shims, except in `src/index.ts` and `src/ai/prompts.ts`. Import from the declaring module.
- New logic goes in `src/domain/`, pure and unit-tested. Handlers orchestrate.
- Decisions live in `docs/adr/`. Read the relevant ADR before changing what it covers.

## Gotchas that already bit us
- **D1 bind limit:** D1 binds at most 100 parameters per statement. Chunk any `IN (...)` built from a list.
- **Migrations:** forward-only, one number each, schema only. Data patches go in `scripts/`, not `migrations/`.
- **Locales:** every new string key goes into both `en.ts` and `uk.ts` (the Mini App has its own `i18n.ts`).
- **Telegram rendering:** Telegram renders no tables. Use a `<pre>` block.
- **AI display text:** pass AI-authored display text through `cleanAi()`.
- **One shared backend:** the bot, Mini App and Android read the same API. Check all three when changing an endpoint or payload shape.
- **More:** see `CONTRIBUTING.md` for the full list.

## Safety
- **Secrets:** never commit or print them. This covers API keys, tokens (Grafana included), the Healthchecks ping URL, signing keys and `.dev.vars`. If a user pastes a secret, don't store it, and advise rotating it.
- **Production:**
  - There is no production DB access. Reason from code and tests, and ask the owner for what only prod can show.
  - Irreversible prod actions need an explicit "yes" from the owner: remote migrations, deletes, secret changes, broadcasts.
- **Git:**
  - Never rewrite history on someone else's branch.
  - Never `git rm -f` modified files.
  - Never skip or disable a test to get green.

## Git and PRs
- Commits use conventional prefixes: `feat:`, `fix(scope):`, `refactor:`, `docs:`, `test:`, `chore:`.
- PRs follow `.github/PULL_REQUEST_TEMPLATE.md`: What this changes / Why / How it was verified / Checklist.
- Keep one goal per PR. Say what changes for the user, not only in the code.
- Squash-merged. After a merge, restart the working branch from `origin/main`.

## Folder rules
`mobile/CLAUDE.md` and `apps/mini-app/CLAUDE.md` add rules for those trees.
