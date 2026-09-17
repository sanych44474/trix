# ADR-0003: do not split into packages/domain|application|ui|adapters

- Status: accepted
- Date: 2026-09-17

## Context

An earlier architecture audit raised the idea of splitting the codebase into
`packages/domain|application|ui|adapters` — a workspace-per-layer structure. Nothing in `src/` or
`apps/` currently imports from any such package, and only `packages/contracts` (the OpenAPI spec,
a data file, not code) actually exists under `packages/`. This was never an agreed target; it
surfaced as an unverified hypothesis and has sat unactioned since.

The current structure already gives functional separation without workspace tooling:
`src/domain/` (41 files, pure/unit-tested), `src/webapp/` (47 files, the `/api/v2/*` seam),
`src/adapters/d1/` (17 files, D1-backed implementations of the interfaces in `src/application/`),
`src/bot/` (27 files). Splitting these into separate npm packages would require introducing
workspace tooling this repo does not have (no `workspaces` field in `package.json`, no path
aliases) and carving ~130+ coupled files apart, for a monorepo with a single deployable Worker
and a single Mini App — there is no second consumer that would need `domain`/`application`
published or versioned independently.

## Decision

Do not pursue the `packages/domain|application|ui|adapters` split. Keep the existing
`src/domain` / `src/application` / `src/adapters` / `src/webapp` / `src/bot` structure as the
functional boundary; `packages/` stays reserved for genuinely cross-cutting, non-code artifacts
(the OpenAPI contract) or a future package with an actual second consumer.

## Consequences

- Closes an open question that kept resurfacing in architecture reviews without a decision
  attached to it.
- If a real second consumer of `src/domain`/`src/application` ever appears (e.g. a separate
  deployable that needs the same pure logic), revisit this decision explicitly — the reasoning
  above is conditioned on "single Worker, single Mini App, no external consumer," not a
  permanent judgment that layered packages are wrong in general.
