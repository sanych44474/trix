# Contributing to trix

Thanks for taking an interest. This file covers the conventions that are genuinely easy to trip
over — the rest is ordinary TypeScript.

## Getting set up

```bash
npm install
cp .dev.vars.example .dev.vars          # fill in at least TELEGRAM_BOT_TOKEN
npx wrangler d1 migrations apply trix --local
npm run dev
```

You do not need a Cloudflare account to work on the pure domain logic or to run the tests —
only to run the Worker itself.

## The two gates

```bash
npm run typecheck    # tsc --noEmit
npm test             # node --test
```

Both must pass before a pull request can merge; CI runs them on every PR, plus a Mini App build
and a CodeQL scan. Please run them locally first — the test suite takes about 30 seconds.

## Conventions that will bite you

**Locale catalogs must stay in sync.** The `Dict` type is derived from `src/locales/en.ts`, and
`uk.ts` and `ru.ts` must satisfy it. Every new string key has to be added to **all three** files
or `npm run typecheck` fails. That failure is the feature, not an obstacle.

**Telegram has no tables.** Markdown tables and HTML `<table>` do not render in a Telegram
message. The only table-like option is a monospace `<pre>` block with space-aligned columns.

**Run AI-authored display text through `cleanAi()`** (`src/locales/i18n.ts`), on both write and
render. Models sometimes emit LaTeX such as `\times`; in JSON `\t` parses to a literal tab and
leaves `"imes"` in the user's plan.

**Never put a literal control character in source.** Use ASCII escapes in regexes
(`/\times/`, `/[\x00-\x1F]/`). A literal NUL byte makes the file read as binary and breaks
tooling.

**Call `env.AI.run(...)` on the binding object.** Destructuring it throws
`Cannot set properties of undefined`.

**Keep new logic in `src/domain/` pure and unit-tested.** That directory holds the parsing,
progression, scoring and analysis math, and it is the part of the codebase that is cheap to
test and reason about. Handlers should orchestrate; domain modules should compute.

## Database migrations

Migrations are forward-only and live in `migrations/`, numbered sequentially:

```bash
npx wrangler d1 migrations apply trix --local     # dev
npx wrangler d1 migrations apply trix --remote    # production
```

- **One number per migration.** Duplicate prefixes break the apply order.
- **Only real schema changes belong in `migrations/`.** A one-off data patch left there *will*
  be executed by the next `migrations apply` against production. Put those in `scripts/` —
  `scripts/patch_*.sql` is gitignored because such files tend to contain real user rows.
- Verify a schema change afterwards with `pragma_table_info(...)` or `sqlite_master`.

## Pull requests

- One goal per pull request. Unrelated changes bundled together are hard to review and harder
  to revert.
- Describe what changes for the user, not only what changes in the code.
- If you touch the plan, logging or nutrition flows, say how you exercised them — the bot has a
  lot of surface that unit tests do not reach.

## Commit messages

Conventional-commit prefixes are used throughout the history: `feat:`, `fix:`, `docs:`,
`chore:`, `refactor:`, `test:`, optionally scoped (`fix(cron): …`).

## Reporting bugs and asking for features

Use the issue templates. For anything security-related, follow [SECURITY.md](SECURITY.md) and
open a private advisory instead of an issue.
