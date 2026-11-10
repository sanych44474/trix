# ADR-0013: session volume counts bodyweight moves; the save returns volume and a kcal estimate

- Status: accepted
- Date: 2026-11-10

## Context

The workout summary showed volume as weight × reps over the logged sets. A pull-up logged at
0 kg added nothing, so a session of pull-ups, dips and push-ups read as almost no work. A tester
asked whether volume counts bodyweight at all. Each client computed the number on its own: the
Mini App in `TrainView.tsx`, Android in `LoggerViewModel.summaryOf`, and the week card in
`domain/weekCard.ts`. The same tester asked for the calories a session burned, as watches show.

## Decision

- **One rule, on the server.** `src/domain/sessionLoad.ts` owns session volume and the kcal
  estimate. `POST /api/v2/workout/save` returns both (`volumeKg`, `kcal`, OpenAPI updated), and
  the week card uses the same per-set rule. A client falls back to plain weight × reps only for a
  save it queued offline.
- **Bodyweight moves count the share of body weight they lift.** The shares are rounded
  force-plate estimates: pull-up, chin-up and muscle-up 100%, dip 95%, push-up 64%, knee push-up
  49%, inverted row 50%, air squat, lunge, step-up and pistol 70%. On pull-ups, dips, push-ups
  and rows, a logged weight (a belt) adds to the share. A loaded squat or lunge counts only the
  logged weight, because that weight is the barbell. Assisted moves (band, gravitron) count only
  what was logged. Abs work and any name not in the table count nothing, which under-reports
  rather than inflates. The body weight is `profile.weightKg`. Without one, bodyweight moves
  count nothing, as before.
- **kcal is an estimate and is labelled as one.** It is MET × body weight × hours, using the 2024
  Compendium of Physical Activities for resistance training: 3.5 MET (light), 5.0 (moderate) and
  6.0 (vigorous). Effort comes from the session's hardest RPE: ≤6 is light, 7 is moderate, ≥8 is
  vigorous, and no RPE counts as moderate. Duration is the measured session time, or 150 s per
  logged set when there is no clock. There is no estimate without a body weight. The figure is
  rounded to 5 and shown as "≈N kcal (estimate)".

## Consequences

- The Mini App, Android and the week card show the same volume, and a bodyweight session reads as
  the work it was.
- Volume is now higher for anyone who logs bodyweight moves and has a body weight. Week-over-week
  comparisons straddling this change will jump once.
- There is no heart rate, so kcal can be off by ±30% for an individual. It is not used anywhere
  else (nutrition targets, adaptive calories), so a wrong estimate misleads only the summary tile.
- Exercise names are matched by pattern in English, Ukrainian and Russian. A move named another
  way counts its logged weight only. Add the pattern to `SHARES`, with a test, when one shows up.
