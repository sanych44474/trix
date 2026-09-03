# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead: go to the
[Security tab](https://github.com/sanych44474/trix/security/advisories/new) and open a draft
advisory. Include what you found, how to reproduce it, and what an attacker could do with it.

Expect a first response within 7 days. If the report is valid, you will be credited in the fix
unless you prefer otherwise.

## Supported versions

This project ships from `main`. Only the latest commit on `main` receives security fixes; there
are no maintained release branches.

## Handling secrets

Everything the bot needs to authenticate is a secret — none of it belongs in the repository.

- `.dev.vars` is gitignored. Never commit it, and never paste its contents into an issue, a
  pull request, or a chat log.
- Production secrets live in Cloudflare (`wrangler secret put`), not in `wrangler.toml`.
- `wrangler.toml` intentionally contains **no** `account_id` and only a placeholder
  `database_id`. Keep it that way; wrangler reads `CLOUDFLARE_ACCOUNT_ID` from the environment.
- GitHub secret scanning with push protection is enabled on this repository. If it blocks your
  push, rotate the exposed credential — do not bypass the block.

If a credential is ever exposed, rotate it first and clean up history second. A rotated token
is safe even if it stays in a fork; a token merely deleted from a file is not.

## Operational notes for anyone self-hosting

These are properties of the deployment, not bugs, but they decide how safe your instance is:

- **`ADMIN_SECRET` is the operator credential.** It guards the `/admin/*` HTTP routes and the
  `/admin` command that claims the owner chat. Use a long random value. Anyone who learns it can
  broadcast to your users and read your operational reports. The owner chat locks to the first
  claimer, so claim it immediately after your first deploy.
- **`/admin/*` currently takes the secret as a query parameter** (`src/index.ts`). Query strings
  are commonly written to intermediary and browser logs — avoid calling these routes from a
  browser address bar, and treat any URL containing the secret as compromised.
- **`TELEGRAM_WEBHOOK_SECRET` is what keeps `/webhook` from accepting forged updates.** It is
  verified as the `X-Telegram-Bot-Api-Secret-Token` header. Set it, and make it random.
- **Mini App requests are authenticated by Telegram `initData` HMAC** on every `/api/*` call.
  The `?debugUser=` bypass is only active when `WORKER_URL` is unset, i.e. in local dev — never
  set an empty `WORKER_URL` on a public deployment.
- **The bot stores personal health data** (body measurements, injuries, optionally cycle
  tracking). If you run an instance for other people, that carries real obligations under GDPR
  and similar regimes. `/deleteme` implements user-initiated erasure across every table.
- **Never commit SQL patches produced against a live database.** `scripts/patch_*.sql` is
  gitignored for exactly this reason — such files routinely embed real user rows.
