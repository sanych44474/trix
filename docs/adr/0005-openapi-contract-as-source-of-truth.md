# ADR-0005: packages/contracts/openapi.yaml is the source of truth for Mini App types

- Status: accepted
- Date: 2026-09-17

## Context

`packages/contracts/openapi.yaml` existed since ADR-0001 but described every operation's response
as `SuccessEnvelope<data: {}>` — no real shape, and no codegen tooling consumed it. Meanwhile
`apps/mini-app/src/types.ts` was hand-written and kept in sync with `src/webapp/*.ts` manually,
session by session. The spec also only covered 25 of the ~37 real `/api/v2/*` base paths the Mini
App actually calls — routes built later (trainer sessions/finance, coach ask/thread, weekcard,
photocompare, library, squads, trainer profile/templates, client-card sub-routes, owner user
moderation, plates, whatsnew) were never added to it.

Two consequences: (1) the spec could not catch a hand-type drifting from the real handler
response, which had already happened once (`TrainerApplication` in `App.tsx` omitted
`approach`/`experienceYears`/`priceOnline`/`accepting`, fields the same route's handler always
returns — found while writing this ADR's own verification pass); (2) every new route needed its
type hand-added to `types.ts` with no check that it matched what the handler actually sends.

## Decision

`packages/contracts/openapi.yaml` is now fully typed: every response schema is verified against
the real `src/webapp/*.ts` handler code (not derived from the old hand types blindly), and the
12+ previously-undocumented routes are added. `openapi-typescript` generates
`packages/contracts/generated.ts` from it; `apps/mini-app/src/types.ts` re-exports or derives
every shared type from that generated output instead of hand-declaring it.

`generated.ts` is **gitignored, not committed** — same reasoning as `worker-configuration.d.ts`
(ADR-independent existing convention): a committed generated file can silently go stale next to a
spec edit nobody remembered to regenerate for. `npm run generate:contracts` runs as part of
`postinstall`, alongside `wrangler types`, so it's always fresh after `npm install`/`npm ci`.

View-LOCAL response types (declared inline inside `Workspace.tsx`/`App.tsx`/etc. for a single
screen's own fetch — e.g. `ClientCardPayload`'s trainer-only sub-actions before this pass, still
several `Workspace.tsx`-local ones after it) are **not** all centralized into the contract by this
change. That split — some types centralized in `types.ts`, most view-specific ones declared where
they're used — is a deliberate, pre-existing convention of this app (explicitly called out in
several of its own file comments) and is a different, separately-scoped decision from "does
`types.ts` itself match the real contract."

### Tooling incompatibility

`openapi-typescript@7.13.0`'s own code imports `ts.factory` from the `typescript` package and
crashes against this project's `typescript@^7.0.2` (a different module surface than the `^5.x`
peer range it expects — not a benign version-skew warning). Installing it as a local
`devDependency` cannot work: Node's module resolution finds the project's shared, hoisted
`typescript@7`, and it crashes at `ts.factory` access the same way every time. The working fix is
invoking it via `npx -y openapi-typescript@7.13.0`, which resolves its own isolated, correctly
peer-satisfied dependency tree instead of the project's `node_modules/typescript`. This is
documented directly in `openapi.yaml`'s own header comment — re-check that note before attempting
to "simplify" this by adding a local devDependency again.

### Schema-authoring gotcha this session hit twice

`{ $ref: '#/components/schemas/X', properties: {...} }` (a `$ref` with sibling keywords) is valid
JSON Schema 2020-12 syntax, but `openapi-typescript@7.13.0` silently **ignores every sibling next
to a `$ref`** — every response using that pattern generated `data: unknown`, discarding the
concrete override entirely, with no error or warning. The working pattern is `allOf: [{$ref: X},
{type: object, properties: {...}, required: [...]}]`, verified against the actual generated output
before being applied across the whole spec (see the file's own `allOf` usage throughout).

## Consequences

- A response shape drifting from what a handler actually returns is now a spec problem to fix in
  one place (`openapi.yaml`), not a silent mismatch between five different `.tsx` files' beliefs
  about the same endpoint.
- Editing a handler's response shape requires updating `openapi.yaml` and running
  `npm run generate:contracts` before `npm run typecheck:webapp` will reflect it accurately — a
  new step in the existing "change a webapp response, update the Mini App" workflow.
- `packages/contracts/openapi.yaml` is a genuinely large, hand-maintained file now (not a
  formality) — treat it with the same care as a migration or a domain type: read it, don't assume,
  before changing a response shape either side of the contract.
