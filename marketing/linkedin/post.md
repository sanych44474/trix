# LinkedIn post: from notebook to bot to Android app

Attach `hack-limits-carousel.pdf` as a document post (it shows up as a swipeable carousel).
Or attach `slide-1.png` … `slide-6.png` as images. Paste the text below as is: it's about
2,950 characters, under LinkedIn's 3,000 limit. Put the "First comment" text in the first
comment.

---

Most ideas don't die in the notebook. They die at the handoff.

Plans in one app, logs in another, food in a third, reminders in my head. I wanted one coach that remembers it all.

That idea became Hack Limits: an AI training and nutrition coach. It started as a Telegram bot and grew into a Mini App and a native Android app. Here's how, step by step 👇

1️⃣ Start with one complete loop
Not a platform. A loop: understand the person → make a plan → help them act → learn from what happened.
Telegram was the lowest-friction place to test it: nothing to install, no sign-up. A short chat interview collects goals, schedule, equipment and injuries. Then the bot builds a weekly plan and checks in on training days.

2️⃣ Make the coach useful between workouts
Chat got cramped fast, so a Mini App came next, inside Telegram: a set-by-set logger with rest timers, plan editing, food logging by photo or barcode, a muscle body map and progress charts. XP, streaks, badges and weekly quests make consistency visible.

3️⃣ Add mobile without building a second product
The Android app (Kotlin Multiplatform, Compose) talks to the same Cloudflare Worker API as the bot and the Mini App. Plans, progression rules and XP live in one place: a workout logged on the phone shows up in Telegram instantly.
Under the hood: D1 for data, Durable Objects for per-user schedules, Queues for broadcasts, R2 for photos, FCM for push. Sign-in works with Google, an email code or Telegram. The session token is encrypted with Android Keystore.

4️⃣ Use AI as an accelerator, with boundaries
AI turned my notes into flows, code slices and test cases. In the product it writes plans, coaches and reads meal photos.
But a model call is one box in the pipeline:
→ structured JSON, not free text
→ a fallback chain across Gemini, Groq, OpenRouter, Workers AI and Ollama, with a budget and retries
→ every plan is checked against the user: no barbell for a home workout, no exercise that hits an injury
→ if every model fails, a catalog plan still ships. The user never sees an error.
Auth, state and validation matter as much as the prompt.

5️⃣ Test the whole journey
1,457 backend tests, 92 Workers-runtime tests and 250+ Android tests run on every PR, with lint, CodeQL and architecture rules. Keys never touch the repo.
And a real tester still found what tests missed: a history list that didn't scroll, a keyboard covering the input, a rest timer that forgot 90 s was his choice. Ship early, listen hard.

The lesson: no giant plan. One user problem, the lowest-friction place to test it, and a new surface only when it made the same loop better.

The project is open source: https://github.com/sanych44474/trix

What's in your notebook right now, and what's the smallest complete loop you could ship this week?

#BuildInPublic #AI #Telegram #Android #Kotlin #Cloudflare #ProductDevelopment

---

## First comment (optional, more depth)

Stack details for the curious:
• Backend: TypeScript on Cloudflare Workers. Domain → application → adapters layering, enforced by a test that fails the build.
• Data: D1 (SQLite) with 100+ migrations, plus R2 for photos and the coach's knowledge base.
• Scheduling: one Durable Object per user replaced a global cron, so reminders follow each person's timezone.
• Broadcasts: Cloudflare Queues with a dead-letter queue, respecting Telegram's rate limits.
• Monitoring: Healthchecks.io pings for the cron, and Analytics Engine for product metrics.
• Android: KMP shared module (Ktor, Koin), Compose UI, Health Connect, separate Play and direct-download builds.
10 architecture decision records live in docs/adr if you want to see why each choice was made.

## Alt text for the images

1. Title slide: "From a notebook to a Telegram bot and an Android app", with the path Notebook → Bot → Mini App → Android and three app screenshots.
2. A loop diagram: Understand → Plan → Act → Learn around an "AI coach" that keeps context.
3. Architecture: Telegram bot, Mini App and Android all call one Cloudflare Worker API, backed by D1, Durable Objects, Queues, R2, Workers AI and FCM.
4. AI pipeline: user context → prompt and schema → provider fallback → validation against the user → deterministic fallback → save and coach.
5. Numbers: 1,457 backend tests, 92 Workers tests, 250+ Android tests, 100+ migrations, 10 ADRs, 5 AI providers.
6. Takeaway: "Pick the lowest-friction place to test one user problem."
