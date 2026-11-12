# ADR-0014: the athlete can limit automatic progression

- Status: accepted
- Date: 2026-11-12

## Context

A tester's dumbbells stop at 30 kg, yet every session the app proposed 32 kg and he overrode it by
hand each time. The engine (`domain/progression.ts`) assumed every load exists: it adds a step
whenever the top of the rep range is reached, both for today's target (`nextTargetSet`) and for the
weekly plan update (`computePlanProgression`).

## Decision

- **Two settings, stored in `profile.progression`** (`{ auto?: false, caps?: { [exercise]: kg } }`):
  an off switch for automatic increases, and a per-exercise ceiling, the heaviest load the person
  has. Exercise keys are lower-cased with collapsed spaces (`capKey`).
- **One pure rule** in `domain/progressionPrefs.ts`, applied in both engine entry points:
  - auto off: the target is exactly what was done (`hold`); the weekly plan stops raising weights
    and rep ranges, but still follows what the athlete actually lifted (it never pushes him, and it
    does not hold him back).
  - a load step past the ceiling lands on the ceiling when the current load is below it. At the
    ceiling it adds reps instead and does not reset to the bottom of the range, because there is no
    heavier weight to earn the reset with. In the weekly plan this grows the rep range, the same
    path bodyweight lifts use.
  - a load above the ceiling that the athlete already lifts is never reduced.
- **Edited through** `POST /api/v2/settings`, action `progression` (`auto`, or `exercise` with
  `capKg`; null clears). Both apps set a ceiling from the exercise's menu in the logger (the target
  is re-read at once) and manage everything in Settings. `GET /workout/today` carries `capKg` per
  exercise and `GET /settings` the full state.
- The coach prompt quotes the limited targets, so the AI never contradicts the ceiling.

## Consequences

- Without settings nothing changes: `limits` is empty and the engine is exactly as before.
- Ceilings are per exercise name, not per equipment: a swapped-in exercise has none until the
  person sets one. A per-equipment ceiling (all dumbbells) can be added on top if testers ask.
- Time and distance exercises have no ceiling; only the off switch applies to them.

## Addendum: one ceiling for all dumbbells

The tester's limit is a piece of equipment, not an exercise: his dumbbells stop at 30 kg for every
dumbbell movement. `caps["@dumbbell"]` is a ceiling for every exercise whose gear is dumbbells and
nothing else (`isDumbbellOnly`, built on `gearFor`). An exercise's own ceiling wins over it. The
workout payload says when the shown ceiling is the shared one (`capShared`) and when the exercise
can offer it (`dumbbellOnly`), so the clients need no gear rules of their own.
