# trix — what is left, and in what order

Status as of 2026-09-22: **P0, P1 (A+B), P0.3, P2.2, P2.4 and P4 are done.** Each item keeps its
original diagnosis below, with a **Done** note recording what shipped or what was decided.

**Deliberately not done, and why:**

- **P2.1 (whole-day plan editing) and P2.3 (squad creation/management)** are new features, not
  repairs, and each needs a product decision before code — "edit the whole day" could mean swap
  its muscle group, clear it, or copy another day, and those are different features. Neither is
  broken today; both are bot-reachable. Scoping them belongs in their own pass.
- **P3 (the four pending cutover flags)** is not code at all. Each is a decision plus a live
  mutation against production, which needs explicit approval at the time it is made — see the
  project's `CLAUDE.md`. Nothing here flips one.
Companion to
[`docs/feature-audit-v2.md`](feature-audit-v2.md), which records what *is* built. This file
records what is not, ranked by "is it broken" before "is it missing".

Baseline at the time of writing: `npm run typecheck` and `npm test` both green, branch `main`,
v2 cutover complete (`V2_APP_ENABLED=1`, `v2_*` tables are the source of truth).

---

# P0 — Broken in production

These are shipped surfaces that do not do what their UI says they do. They are not long-tail.

## P0.1 The Mini App plan editor cannot swap or add an exercise

**Symptom (as reported):** a trainer opens a client's plan, searches the catalog, taps a
replacement exercise from the result list — and nothing is applied. Same for the plain
"add exercise" field.

**Root cause:** a request-field mismatch between the client and the handler.

<table>
<tr><th>Side</th><th>File</th><th>What it does</th></tr>
<tr><td>Client</td><td><code>apps/mini-app/src/App.tsx:139</code></td><td>The shared <code>edit()</code> helper always serializes the payload as <code>value</code>: <code>...(value !== undefined ? { value } : {})</code></td></tr>
<tr><td>Client</td><td><code>apps/mini-app/src/App.tsx:239</code></td><td>Catalog tap calls <code>edit(weekday, index, "swap", choice.name, exercise.name, { catalogId: choice.id })</code> → sends <code>value: "Incline Press"</code></td></tr>
<tr><td>Server</td><td><code>src/webapp/planApi.ts:231</code></td><td>The <code>swap</code>/<code>add</code> branch reads <code>String(body.name ?? "")</code> → <code>""</code> → fails the <code>length &lt; 2</code> guard → <b>HTTP 400 <code>bad request</code></b></td></tr>
</table>

**Scope is wider than reported.** Every other action (`weight`, `sets`, `wmode`, `video`) reads
`body.value` and works. Only `swap` and `add` read `body.name`. So this breaks:

- exercise swap from the catalog list (trainer-for-client **and** a solo user's own plan),
- exercise swap from the free-text field,
- "add exercise" to a plan day.

It is **not** trainer-specific — `clientId` resolution in `planApi.ts:142-147` is correct. The
trainer flow is simply where it was noticed, because swapping an exercise for a client is the
thing a trainer does most.

**Why every check missed it.** Per [ADR-0005](adr/0005-openapi-contract-as-source-of-truth.md)
the OpenAPI contract types **responses**, and `apps/mini-app/src/types.ts` derives from it — so
`npm run typecheck:webapp` validates what comes back and nothing about what goes out. Request
bodies are assembled by `jsonBody(someObject)` and are `unknown` on both sides. Meanwhile
`test/plan-api.test.ts:81,87` hand-writes `name`, matching the handler rather than the real
client, so the suite is green against a payload the app never sends. The contract itself
(`packages/contracts/openapi.yaml:363-364`) declares **both** `value` and `name` as optional, so
it blesses both spellings and adjudicates neither.

**Fix:** accept `body.value ?? body.name` in the `swap`/`add` branch (keeps the bot, the tests and
any older client working), and make the client send the field the contract prefers. Then tighten
the contract so only one spelling is legal.

**Regression test:** a `plan-api` case that posts the *exact* body `App.tsx`'s `edit()` builds —
not a hand-written one — for both `swap` (with `catalogId`) and `add`.

> **Done.** `planApi.ts` now reads `body.value ?? body.name`. Test
> `"plan editor: swap and add accept the Mini App's \`value\` payload, not just \`name\`"` covers
> catalog swap, free-text swap and add, and asserts an empty value is still rejected. Verified
> by reverting the handler fix: the new test fails, the four pre-existing ones still pass —
> which is exactly why they never caught it.

## P0.2 "Stop rest" does not stop the rest push

`stopRest()` (`apps/mini-app/src/TrainView.tsx:145`) clears local state only. The server row
written by `POST /api/v2/workout/rest` (`setRestTimer`, `src/adapters/d1/v2Admin.ts:506`) is
never cancelled — `deleteRestTimers` is called exclusively by the scheduler *after* it has
already sent the message (`src/scheduler.ts:357`).

So: the user taps Stop, starts the next set, and up to a minute later Telegram pushes "rest is
over" for a rest they explicitly cancelled. Needs a cancel path (`DELETE /api/v2/workout/rest`,
or `seconds: 0` on the existing POST) wired to `stopRest`.

> **Done.** `DELETE /api/v2/workout/rest` added (`workoutApi.ts`), declared in the contract, and
> wired to `stopRest`/Skip. Test asserts the row is gone after the DELETE and that cancelling
> with nothing pending is a 200 no-op, since the client fires it on every Stop.

## P0.3 Mini App plan edits are invisible to the plan change log

`recordPlanChange` is called by the bot's editor (`src/bot/planExerciseEdit.ts:356,370`) and by
the injury flow, but **not once** by `src/webapp/planApi.ts`. A plan edited in the Mini App
leaves no audit trail, while the same edit made in chat does.

Related: `listPlanChanges` (`src/db/repos/planChangeLog.ts:21`) currently has **no consumer
anywhere in `src/`**. The log is write-only. Decide one way or the other — either surface it (see
P2.4) or delete the read side. Do not leave it half-wired.

> **Done — decided to surface it, not delete it.** `planApi.ts` now records every edit
> (`manual` for self, `trainer` when a coach edits a client's plan, against the *client's*
> account) and returns the last 10 entries on both `GET /plan` and the edit response. `PlanView`
> renders them in a collapsible History card, so one reader serves the athlete and the trainer.
> Two tests cover the round-trip and the trainer attribution.

---

# P1 — The rest timer: user-friendly and gamified

This is the requested feature. It is scoped deliberately so that Phase A and Phase B need **no
migration and no new table**, and only Phase C does.

## Where it stands today

- **Delivery is real and already solved.** A due timestamp is persisted in `v2_rest_timers` and
  the per-minute cron pushes a Telegram message, worst case ~60 s late. A Durable Object for
  sub-second precision was considered and declined — see
  [ADR-0002](adr/0002-no-do-rest-timer.md). **P1 does not reopen that decision.** Everything
  below is presentation, control and motivation, not delivery.
- **The countdown is technically sound.** `restEndAt` is an absolute epoch, recomputed from
  `Date.now()` every tick, with `visibilitychange`/`focus` listeners, so a locked screen or a
  backgrounded Mini App cannot desync it (`TrainView.tsx:114-137`).
- **The presentation is the problem.** All of that resolves to *one line of muted text* —
  `train_resting_label` plus a "stop" text button — rendered near the **bottom** of a long
  scrolling exercise list. On a real session the user is scrolled somewhere else and simply
  cannot see it.

### Concrete gaps

<table>
<tr><th>#</th><th>Gap</th><th>Evidence</th></tr>
<tr><td>1</td><td>The running timer is not visible unless you scroll to it</td><td><code>TrainView.tsx:253</code> — the rest note is a sibling at the end of the view stack, not pinned</td></tr>
<tr><td>2</td><td>No way to adjust a running rest (+15 / −15) or to extend it</td><td>Only <code>startRest</code> / <code>stopRest</code> exist</td></tr>
<tr><td>3</td><td>The preferred rest length is forgotten every session</td><td><code>restSeconds</code> is component state seeded from <code>DEFAULT_REST_SEC = 60</code>; the retired shell persisted it (<code>src/webapp/client/logger.js:644</code>, <code>lgRestPref()</code>) — this is a <b>regression</b> against the shell v2 replaced</td></tr>
<tr><td>4</td><td>One haptic at zero and nothing before it</td><td><code>notificationOccurred("success")</code> fires once; no 3-2-1 warning, no sound option</td></tr>
<tr><td>5</td><td>The timer vanishes 4 s after zero</td><td><code>setTimeout(() =&gt; setRestDone(false), 4000)</code> — overrun, the number that tells a lifter the session is drifting, is never shown</td></tr>
<tr><td>6</td><td>Nothing about the session feels like progress</td><td>Level, XP, streak, challenges and badges all exist (<code>src/domain/gamification.ts</code>, Connect workspace) but the Train screen shows none of them</td></tr>
</table>

## Phase A — make it usable (no schema change)

1. **Sticky rest bar.** Pin the running timer above the bottom nav: a progress ring (or bar), a
   large `M:SS`, and the exercise + set number it belongs to. Visible regardless of scroll.
2. **In-bar controls:** `−15s` · `+15s` · `Skip`. Each re-arms both the local `restEndAt` and the
   server row — `setRestTimer` is an upsert `ON CONFLICT(accountId) DO UPDATE`
   (`v2Admin.ts:509-511`), so re-posting simply moves `dueAt`. `Skip` uses the P0.2 cancel path.
3. **Remember the preferred rest**, per metric (reps / time / distance), in `localStorage`
   alongside the existing workout draft. Restores the `lgRestPref()` behaviour lost in the v2
   rewrite. Plan-supplied `exercise.restSec` still wins when present.
4. **Escalating feedback:** light haptics at 3-2-1, success haptic at 0, plus an optional short
   WebAudio tone (default off, remembered per viewer) so the phone can sit on the bench.
5. **Count up after zero.** Replace the 4-second disappearing note with `+0:42 over`, until the
   next set is entered.
6. **Make auto-start explicit.** Rest already auto-starts from the `onBlur` of any set input with
   a value (`TrainView.tsx:253`) — which is good behaviour that is nowhere announced. Surface it
   as a visible toggle so it is predictable rather than surprising.

## Phase B — gamify it (still no schema change)

7. **Live session density.** Work-vs-rest ratio for the current session, computed client-side
   from set timestamps, shown as a slim bar in the rest bar. The single most motivating number
   in a training app, and it costs nothing to store.
8. **Rest-discipline chip.** Consecutive sets resumed within ±15 s of the target rest — `🎯 4 in
   a row`. Session-local, resets each session, no persistence.
9. **Session summary on save.** One card: elapsed time, work/rest ratio, rest discipline %, sets
   completed, volume vs the previous session, and any PR hit (`computeBoards` already produces
   the PR data).
10. **Surface the existing progression on the Train screen** — level, XP-into-level and streak,
    which today only appear in the Connect workspace. This is what makes the timer feel part of a
    system rather than a stopwatch.

> **Done (Phase A + Phase B).** All of 1-10 shipped in `apps/mini-app/src/TrainView.tsx` plus
> `styles.css`, with no migration and no new table:
>
> - **Sticky `.rest-bar`** above the bottom nav: conic-gradient progress ring, `M:SS`, and the
>   exercise + set the rest belongs to. Themed for light and dark alongside `.bottom-nav`.
> - **`-15` / `+15` / `Skip`** in the bar. Adjusting re-arms the server row through the same
>   upsert; Skip uses the P0.2 cancel route.
> - **`REST_PREFS_KEY` in `localStorage`**, per metric (reps/time/distance) plus the `auto` and
>   `sound` toggles, reachable from a gear next to each exercise's rest button. A plan-supplied
>   `restSec` still wins, and the chip row says so.
> - **3-2-1 light haptics**, success haptic at zero, and an optional two-tone WebAudio chirp
>   (default off; the `AudioContext` is built per chirp and closed after, so nothing throttles).
> - **Counts up past zero** (`+0:42`) instead of vanishing after 4 s, capped at 5 minutes so an
>   abandoned rest cannot pin a bar to the screen.
> - **Auto-start is now an explicit, remembered toggle** rather than undocumented `onBlur`
>   behaviour.
> - **Live density + rest-discipline streak** in the bar (`density()`, `SessionQuality`),
>   measured from real rest taken — overrun included — with the target moving when the user
>   deliberately taps +/-, so an intentional adjustment does not score as a miss.
> - **Session summary card on save**, which also fixed a smaller drift: `saveWorkout()` has
>   always returned `prExercises` / `newBadges` / `level` / `leveledUp` / `totalWorkouts`, the
>   contract declared only `{ok: true}`, and the app discarded the whole response to show a
>   one-line note. The contract now matches the handler and the app renders it.
> - **Level and streak on the Train screen** (passed down from the dashboard App.tsx already
>   loads), where previously nothing suggested the session counted towards anything.
>
> Not covered by automated tests: this is all React, and the repo has no client test harness
> (`npm test` runs `test/*.test.ts` against worker code). The server side of it — the cancel
> route — is tested. Adding a component harness was out of scope for this pass.

> **Deliberate non-goal in Phase B: no rest-based XP.** `computeXp`
> (`src/domain/gamification.ts:13`) is documented as deterministic from all-time counts with "no
> new tables, no state to migrate". Feeding rest behaviour into it would silently break that
> property and make every historical XP number unreproducible. Phase B therefore *displays*
> rest quality and *reuses* the existing XP sources; it does not mint a new currency.

## Phase C — persist rest (schema change; decide explicitly)

Only if historical rest analytics, trainer visibility into rest, or rest-based XP is actually
wanted. Needs `v2_workout_sets.restSec` (migration), a contract change, and adapter changes in
`src/adapters/d1/v2Workouts.ts`. **Not recommended to bundle with A/B** — ship A and B, see
whether anyone looks at the density number, then decide.

---

# P2 — Real gaps, no user-visible breakage

## P2.1 Trainer workspace

- **Whole-day plan editing** — per-exercise editing is complete; replacing or reordering a whole
  day is still bot-only (noted in `feature-audit-v2.md`).
- **Plan templates** exist (create / assign); there is no way for a trainer to preview a template
  before assigning it.
- **In-app interview/onboarding chat** is bot-only by design — keep it that way, it is the right
  medium. Listed only so it is not mistaken for an oversight.

## P2.2 Nutrition long tail

- **Photo-of-food logging** — **decided, see [ADR-0007](adr/0007-photo-of-food-stays-in-the-bot.md).**
  Writing it up overturned the stated reason: the Mini App *does* have an upload path
  (`POST /api/v2/photo`, used for progress photos), so "no route to build on" was false. It
  stays bot-only for a different and better reason — the value is in the conversational
  correction loop after the estimate, not the upload — and the `Fuel` screen's text AI quick-log
  already covers most of the same need.

## P2.3 Social

- **Squad creation and management** stays bot-only; the Mini App has a read-only squad view.

## P2.4 Plan change log

Either surface `listPlanChanges` in the trainer client card and the plan screen, or remove the
read side. See P0.3.

> **Done** as part of P0.3 — surfaced on the plan screen, for the athlete and for a trainer
> viewing a client.

---

# P3 — Operational decisions that are still open

These are flags and switches sitting in a pending state. None of them is a code task; each is a
decision plus a live mutation, and every one needs explicit approval at the time.

<table>
<tr><th>Switch</th><th>Where</th><th>State</th><th>What is pending</th></tr>
<tr><td><code>scheduler_cutover_user</code></td><td><code>v2_settings</code> via <code>src/durable/cutover.ts</code></td><td>off (dry-run)</td><td>Durable-Object user reminders still shadow-run; cron is the real actor</td></tr>
<tr><td><code>scheduler_cutover_squad</code></td><td>same</td><td>off</td><td>same, for squads</td></tr>
<tr><td><code>scheduler_cutover_global</code></td><td>same</td><td>off</td><td>same, for global jobs</td></tr>
<tr><td><code>CUTOVER_LEGACY_FROZEN</code></td><td><code>wrangler.toml:110</code></td><td><code>"0"</code></td><td>Legacy tables still writable; freezing makes a stray write fail loudly</td></tr>
</table>

The staged design is deliberate (`cutover.ts` header: per-type, not one global switch, so each
type's blast radius is separate). The open item is simply that all three have been sitting at
dry-run — someone has to look at the dry-run comparison output (`scripts/`, added in `87521e9`)
and decide.

**The procedure is now written down: [`docs/scheduler-do-cutover-runbook.md`](scheduler-do-cutover-runbook.md).**
Writing it surfaced a precondition that existed nowhere: a DO only fires if its alarm was ever
armed, and the cron arms them lazily, only for entities with a NULL `doWokenAt`. So flipping the
user or squad flag while any entity is still unwoken would silently stop reminders for exactly
those entities. The runbook has the (read-only) gate query for each, verified against the local
D1. It also corrects the order — `global` → `squad` → `user`, smallest blast radius first, not
the order this table happens to list them in.

**Legacy shell removal.** `src/webapp/client/*` is 269 KB of retired vanilla-JS kept as the
rollback path ([ADR-0006](adr/0006-retire-legacy-app-shell.md)), still built by
`npm run build:webapp` on every deploy. It should get an expiry date rather than an indefinite
stay.

---

# P4 — Prevent the P0.1 class of bug

P0.1 was a request-body mismatch that passed typecheck, passed the unit suite and was blessed by
the contract. The same hole is open for every other route.

1. **Type request bodies from the contract**, the way responses already are. `openapi-typescript`
   emits `requestBody` types into `packages/contracts/generated.ts` already — the Mini App just
   does not use them. Wiring `jsonBody` to a per-route request type would have made P0.1 a
   compile error.
2. **Make the contract decide.** `openapi.yaml:363-364` allows `value` *and* `name` for the same
   operation. Split the plan-edit body into a proper discriminated union keyed on `action`, so
   each action declares exactly the fields it takes.
3. **Test the payload the client actually builds**, not a hand-written equivalent. The existing
   `test/plan-api.test.ts` is green precisely because it hand-writes the server's spelling.
4. **Fix the `on:` key while in there.** `openapi.yaml:370` declares a property literally named
   `true`, because YAML 1.1 parses the bare key `on:` as a boolean. The meso toggle's real field
   is `on` (`planApi.ts:164` reads `body.on`). Quote it.

> **Done (1, 2-partly, 4); 3 done for the plan route.**
>
> - `RequestBody<Op>` (`types.ts`) derives an operation's declared JSON body from the generated
>   contract, and `typedBody<Op>()` (`api.ts`) is `jsonBody` checked against it. Applied to the
>   plan editor and the rest timer — the routes touched this pass.
> - **A first attempt at this did not actually work, and the check caught it.** Wrapping the
>   existing `...(cond ? { value } : {})` spreads in `typedBody` typechecked clean even with
>   `valu` substituted: TypeScript's excess-property check does not see through a spread. The
>   body is now built as flat properties (`clientId: clientId ?? undefined, value, expectName`)
>   and the `extra` parameter is typed `Partial<PlanEditBody>`, so both a mistyped direct field
>   and a mistyped field at a call site are errors. Verified by deliberately breaking each and
>   confirming TS2561 with the right suggestion.
> - `'on'` is quoted; the generated type now has `on?: boolean` instead of a property named
>   `true`.
> - `value` is documented as canonical and `name` marked `deprecated` — the handler still accepts
>   both so older payloads and the pre-existing tests keep working.
>
> **Follow-up pass — the sweep is done, and it was not mechanical.** Every POST call site with a
> declared request body now uses `typedBody`. Four routes had `additionalProperties: true`
> catch-alls in the contract (`editNutrition`, `updateProfile`, `updateSettings`,
> `updateTrainerProfile`); all four now declare their real fields, read off the handlers. Typing
> the call sites then surfaced **six further contract/handler disagreements that had been live**:
>
> 1. `QuickLogRequest` marked all eight fields required; the handler treats every one but `kind`
>    as optional, and reads three more (`energy`/`sleep`/`stress`) the spec never declared.
> 2. `SaveWorkoutRequest` required `date` and all five set fields; only `reps`+`weight` are
>    required, `date` is omitted for a same-day save, and entry-level `rpe` was undeclared.
> 3. `mutateTrainerSessions.price` was `{type: number}`, but `null` is a *meaningful* value
>    there ("no price"), explicitly handled by `money(..., {required: false})`.
> 4. `ProfilePayload.profile.level` was `string` on the way out and an enum on the way in — the
>    settings form round-trips that object, so the two could not both be right.
> 5. `ProfileView.tsx` declared its **own local `ProfilePayload`**, shadowing the contract type
>    and silently stale: missing `waterEvery`, `quietFrom`, `quietTo`, `reminderHour`,
>    `referralLink` and `referredCount`. Deleted in favour of the generated type.
> 6. Two client-side widenings the loose types had been hiding — a `level` select typed `string`
>    and a `[0.5, 1.5, 2]` factor array inferring as `number[]`.
>
> None of these were breaking today, but each is the same shape as P0.1: a spec that describes a
> request nobody sends. Four body-less routes (`requestClientPhoto`, `nudgeClientInterview`,
> `askInactiveUsers`, `moderateUser`) correctly stay on `jsonBody({})` — `RequestBody` is `never`
> for them because the contract declares no body, which is accurate.
>
> **Still open:** the plan-edit body is one flat object rather than a true per-action
> discriminated union. Lower value now that field names are checked.

---

# Suggested order

1. **P0.1** — one-line handler fix plus a real regression test. Unblocks the reported trainer
   complaint and the same break for every solo user.
2. **P0.2** — cancel route; small, and it removes a push that actively annoys people.
3. **P1 Phase A** — the rest timer becomes usable.
4. **P0.3 / P2.4** — decide the plan change log, then wire or delete it.
5. **P1 Phase B** — gamification on top of a timer that already works.
6. **P4** — contract hardening, so the next P0.1 is a compile error.
7. **P3** — flag decisions, each with its own approval.

Nothing above changes live state. Every deploy, `d1 execute --remote` and secret write still
needs explicit per-session approval, per `CLAUDE.md`.
