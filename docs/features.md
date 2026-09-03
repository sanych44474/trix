# trix — Feature Catalog

Complete inventory of everything the product does, across both surfaces (Telegram bot chat and
the Telegram Mini App) and all roles (solo athlete, trainer's client, trainer, owner).
Infrastructure: Cloudflare Workers + D1 (SQLite), free tier only; AI chain
Gemini → Groq → OpenRouter `:free` → Workers AI with automatic fallback. Bilingual UA/EN
(full i18n, typecheck-enforced key parity).

---

## 1. Onboarding & roles

- **Role choice at /start**: solo (AI coach), find a trainer, or become a trainer.
- **Button-driven intake wizard** (11 steps: sex, age, height/weight, goal, level, training
  weekdays, equipment, lifestyle, sleep schedule, diet, limitations) — deterministic, no AI
  per turn; also available as a **web form in the Mini App** for incomplete profiles.
- **AI plan generation** on finish: bank-first (pre-built plan bank / templates → zero AI),
  AI with provider fallback otherwise; async-safe (`plan_pending` recovery via cron survives
  Worker timeouts).
- **Stuck-onboarding recovery**: daily nudge resumes the exact unanswered question; owner can
  bulk-ping everyone incomplete; typed answers are pulled back into the wizard even if the
  session drifted (safety net + regression test).
- **Referral program**: `/start ref_<id>` deep link; "👥 Invite a friend" button generates a
  personal link; the inviter earns the 🤝 badge + a notification when the friend finishes
  the interview (idempotent, no retro-claims).

## 2. Training plan

- **Weekly split plan** with per-exercise sets/reps, start weights, technique notes, RPE/RIR,
  rest, tempo, role (primary/accessory), muscle tags.
- **Supersets & circuits**: `supersetGroup` letters — AI can generate them, and both the user
  and the trainer can link/unlink pairs with the 🔗 button in the Mini App plan editor;
  rendered as 🔗A1/A2 chains in the app and "superset/circuit" labels in chat.
- **Plan editing** (bot + Mini App, self + trainer-for-client): change weight/sets, swap
  (catalog search or custom name with auto video lookup), add/delete exercises, reorder
  (⬆️⬇️), add/delete whole days (weekday + muscle-group picker, auto-filled by level),
  personal video override per exercise. Optimistic concurrency (version + expectName guards).
- **Warm-up editor** with AI suggestion per day.
- **Progression engine**: weekly difficulty adjustment (ok/up/down), plateau detection with
  suggested fixes, level-up flow (beginner → intermediate → advanced regenerates volume),
  goal-switch flow, per-set RPE/RIR capture feeding autoregulation.
- **Injury-aware planning**: report pain by area/severity → conflicting exercises are swapped
  for safe ones; scheduled follow-ups with a 0–10 pain scale; auto-restore when recovered.
- **Strength standards**: big-lift classification (beginner→elite) relative to bodyweight,
  with the load needed for the next tier.
- **Plate & warm-up calculator**: working weight → plates per side + warm-up ramp.

## 3. Workout logging

- **Guided logger in the Mini App** (primary): today's exercises as cards with plan hints,
  one-tap "✓ as planned" fill, per-set weight/reps (or time/distance for cardio), add/remove
  sets, per-exercise RPE chips, on-the-fly swap (3 alternatives or catalog search/create),
  add ad-hoc exercise, delete exercise from today (confirm if data typed), ⬆️⬇️ reorder,
  technique + video dropdown per exercise.
- **Session progress**: "3/6 ▰▰▰▱▱▱" header, ✅ on filled cards, auto-scroll to the next
  exercise, local draft (survives connection loss), idempotent save.
- **"Repeat last workout"**: per-exercise chip with what you actually did last time
  (weights × reps) and a one-tap apply-to-all.
- **Rest timer**: one footer button with a duration picker (0:30–3:00, remembered), countdown
  in the button, server-side push when rest ends (survives screen lock).
- **Edit a saved workout**: reopening a logged day prefills the saved sets ("Save changes");
  past 7 days editable via date chips (14-day window; past edits don't ping the trainer).
- **Bot fallbacks**: free-text logging ("80 8,7,6" / "80x8 75x10"), tappable set correction,
  guided per-exercise chat flow, past-day logging, voice-note logging (Whisper), cardio menu
  (rowing/bike/run/… by time & distance).
- **Finish rewards**: new PRs 🏆, badges 🏅, level-ups ⬆️ shown immediately.

## 4. Nutrition

- **AI food logging**: free text or photo (vision) → KBZHU estimate; portion fix buttons
  (½ / 1.5× / 2× / exact grams); alcohol calories counted; item-level edit (re-weigh, replace
  product, delete); frequent-foods quick re-log.
- **Food database search** (Mini App): Open Food Facts proxy — exact per-100g macros, pick +
  grams → precise entry; AI stays the free-text fallback.
- **Daily targets**: goal-based calories/macros, separate rest-day targets, adaptive calories
  (trend vs goal pace, ±150 kcal max, explained).
- **Meal plan**: AI menu from allergies/likes/dislikes intake; "what to eat" suggestion for
  the macros left today.
- **Nutrition view in the Mini App**: today's meals, totals vs targets, meal plan, day editing.

## 5. Body & activity tracking

- **Weight & measurements** (waist/chest/hips/arm/thigh): free-text parsing in chat, quick
  form in the app; trends charted in both surfaces (multi-line measurements chart in the app).
- **Weight goal projection**: trend (kg/wk) + ETA, on/off-track flag.
- **Steps, water** (one-tap +250/500/750), **daily wellbeing check-in** (energy/sleep/stress)
  with trend chart and pre-workout readiness advice.
- **Personal goals**: custom daily water (default 35 ml/kg) and steps (default 8000) targets.
- **Activity rings** (Mini App home): workouts this week / water today / steps today.
- **Progress photos**: trainer-requested or self-serve 📸; gallery in the app profile and on
  the trainer's client card (authorized proxy — bot token never exposed).
- **Menstrual-cycle tracking** (opt-in, female users): calendar date picker, phase-aware
  coaching hints, deload/carb nudges; medical data gated behind trainer-consent.

## 6. Gamification

- **XP & levels** from every logged activity; visual XP progress bar + level in the app header.
- **Week streak** with vacation freeze and an **automatic streak freeze** (one missed week
  inside a ≥4-week streak is bridged, Duolingo-style).
- **Badges** (12): first workout, 10/50/100 workouts, first PR, streak 4/12, balanced week,
  level 5/10, referral 🤝 — catalog screen (earned ✅ / locked 🔒) + pop-in celebration
  animation with haptics when a new one lands.
- **Leaderboards** (opt-in, alias or anonymous): consistency, most improved, relative
  strength, total volume — top-5 with medals + own rank; weekly rank digest with
  **competitive pushes** ("X overtook you — strike back!").
- **Challenges**: joinable consistency goals (e.g. 4 workouts/week) with progress bars.
- **Quality rating & feedback**: recurring light "how's it going?" ask every 2 weeks.

## 7. Trainer features

- **Client acquisition**: personal invite code/link, public trainer directory with filters
  (goal/tag/language), client requests inbox (accept/decline), client limit + waitlist,
  reviews & rating, trainer profile wizard (bio, prices, photo, specializations).
- **Client card** (bot + Mini App): compliance, charts, private notes, 🩺 health notes,
  🎂 personal notes + birthday reminder, intake answers + "remind to finish" ping,
  ⚡ 6-question mini-interview FOR the client → instant plan draft, progress photos,
  consent-gated body/health data (client opt-in toggles).
- **Plan management**: full plan editor for each client (same as self-edit incl. supersets
  and day add/remove), reusable program templates (save/assign, weights auto-adapt),
  program sharing (link / public library / direct assign to selected clients).
- **Sessions**: booking calendar with time zones, propose/confirm/cancel, meeting links,
  day-before + same-day reminders, completed sessions decrement prepaid packages.
- **Billing**: paid-until / session packages per client, 💰 finance summary
  (paying/expiring/expired), expiry nudges.
- **Communication**: message a client, 📢 broadcast to all clients, ❓ client questions inbox
  (answer/keep/skip), 📸 request a progress photo, forwardable client week card.
- **Monitoring**: weekly digest (traffic-light per client), at-risk alerts (2 missed planned
  sessions in a row / nutrition lapse), on-demand client report table (interview status,
  plan/draft, W/C/N/S activity, last-active).

## 8. Mini App platform

- **Bottom tab bar** (🏠 Home / 🏋️ Workout / 📋 Plan / 🍽 Food / ⭐ More / 🛠 Owner) + 👤
  profile; feels like a native app.
- **Instant open**: last dashboard cached in localStorage (stale-while-revalidate), skeleton
  shimmer on first run, pull-to-refresh, slide-in overlay animations, haptics on every tap.
- **Dashboard**: level/XP/streak, activity rings, "Today's workout" hero card, quick log
  (water/exercise/food/steps/measurements/check-in with per-control confirmation), weight +
  goal forecast, measurements chart, interactive month calendar (taps → day detail), 12-week
  heatmap, weekly volume vs MEV/MAV, e1RM by muscle group (top-3 lifts per group), macros vs
  targets.
- **"More" screen**: challenges, injury log/report, leaderboards, personal records (tap →
  e1RM history chart), badges, week card, plate calculator, program library, find-a-trainer,
  what's new.
- **Profile & settings**: profile fields, water/steps goals, trainer-sharing consent,
  reminders toggles, vacation mode, language, cycle tracking, compete opt-in + alias,
  data export (Markdown via document push), leave trainer, delete account, progress photos,
  onboarding form.
- **Deep links**: reminder buttons open the exact screen (`?view=log|survey|…`,
  `t.me/...?startapp=` supported).
- **Reliability**: initData HMAC auth everywhere, client JS errors reported server-side
  (deduped), CSP self-only, static assets on the edge, minified build.

## 9. Reminders & automation (cron)

- Per-user timezone-aware scheduling; smart reminder-hour suggestion from actual training
  times; every reminder individually togglable; vacation mode pauses everything.
- Workout reminder (with plan preview + "log in the app" button), one combined **evening
  check-in at 21:00** (water/steps/food/wellbeing checklist that re-shows remaining items),
  tomorrow's training preview, pre-workout readiness check, injury follow-ups, weekly records
  digest + rank-change pushes, Sunday week digest, trainer at-risk alerts and billing nudges,
  session reminders, plan-generation recovery sweep, hourly leaderboard cache, cron heartbeat
  (dead-man alert to the owner if the cron stops).

## 10. Owner / admin

- **Owner console in the Mini App** (🛠 tab, owner-only): all report sections rendered
  in-app + one-tap "ask inactive 7d+ users for feedback" (their replies land in /feedback).
- **/ownerreport**: pulse line + sections — Overview (funnel bars, DAU sparkline, WoW deltas,
  attention list), AI health (traffic-light verdict, provider table, latency, plan-source
  offload), Trainers, Onboarding (stage funnel, stuck users + fix path), Errors + audit
  trail, Usage events (proportional bars), full Users table.
- **User management**: per-user card (events timeline, continue interview, assign plan,
  block/unblock, delete), cleanup of inactive users with confirmation, broadcast/announce,
  release-notes broadcast with confirm gate, video moderation (set/refresh exercise videos),
  daily AI-error report, proactive error-spike / provider-outage alerts.

## 11. Engineering safeguards (invisible features)

- 260 unit/integration tests; typecheck-enforced bilingual catalogs; session-mode registry
  with compile-time exhaustiveness; callback route tables with a prefix-conflict detector;
  D1 migrations tracker (rebaselined, standard tooling); idempotent saves everywhere;
  reminder dedup that survives crashes; scheduler mutex; AI input identical across fallback
  providers; `cleanAi()` sanitizer against LaTeX/control-char artifacts; GDPR delete
  (`/deleteme`) wipes every table including photos.
