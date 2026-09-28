## What this changes

<!-- What changes for the user, not only what changes in the code. -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## How it was verified

<!-- Tests added, flows exercised by hand, screenshots for Mini App changes. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] New user-facing strings added in **both** languages (`en`, `uk`), in the bot and/or Mini App catalog
- [ ] New domain logic lives in `src/domain/` and is unit-tested
- [ ] Any new migration has a unique sequential number and is a real schema change
      (one-off data patches belong in `scripts/`)
- [ ] No secrets, tokens, or real user data in the diff
