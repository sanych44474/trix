# trix — Scalability & Paid-Tier Migration Roadmap

A staged plan for growing `trix` from "runs entirely on free tiers" to "minimal paid tiers"
as usage rises. Each stage lists the **trigger** (what metric forces it), the **change**
(concrete edits to this codebase / config), an **approximate cost**, and the **risk /
rollback**. Upgrade one stage at a time, only when its trigger fires — do not over-provision.

> Exact external limits and prices change. Figures below marked **(verify)** must be
> re-checked against current Cloudflare / Google AI pricing before acting — do not treat
> them as authoritative. The triggers and code changes are the durable part of this doc.

## Current footprint (Stage 0 — all free)

<table>
<tr><th>Component</th><th>Plan</th><th>Approx free ceiling (verify)</th><th>First thing that breaks</th></tr>
<tr><td>Cloudflare Workers</td><td>Free</td><td>~100k requests/day; ~10 ms CPU/req; limited cron</td><td>Webhook volume; cron CPU as user count grows (the hourly cron loops <em>every</em> onboarded user)</td></tr>
<tr><td>Cloudflare D1</td><td>Free</td><td>~5 GB; ~5M rows read/day; ~100k rows written/day</td><td>Daily <em>rows-read</em> first — leaderboards + reports scan many rows</td></tr>
<tr><td>Workers AI</td><td>Free</td><td>~10k Neurons/day</td><td>Only used as last-resort fallback, so rarely the bottleneck</td></tr>
<tr><td>Google Gemini</td><td>Free</td><td>Per-minute & per-day request caps on <code>gemini-2.5-flash</code></td><td>Onboarding/plan-gen throttling (429) under bursty load — already seen historically</td></tr>
<tr><td>OpenRouter</td><td><code>:free</code> models</td><td>Rate-limited free models</td><td>Fallback quality/availability</td></tr>
<tr><td>Telegram Bot API</td><td>Free</td><td>~30 msg/s global; per-chat limits</td><td>Broadcast bursts (weekly nudges/digests) hitting global send rate</td></tr>
</table>

**Where it breaks first, in order:** (1) Gemini free throttling on AI-heavy flows, then
(2) D1 daily rows-read as `/records` + reports fan out, then (3) Workers cron CPU/time as
the per-user loop grows, then (4) Telegram send-rate on weekly broadcasts.

## Stage 1 — Workers Paid ($5/mo): the one cheap unlock

The single highest-leverage upgrade. The Workers Paid plan raises Workers limits **and**
lifts D1 to its paid ceilings in one move.

<table>
<tr><th>Field</th><th>Detail</th></tr>
<tr><td><b>Trigger</b></td><td>Any of: Workers requests approaching the daily cap; D1 daily rows-read/written nearing the free limit; cron exceeding free CPU; need for richer observability.</td></tr>
<tr><td><b>What you get (verify)</b></td><td>~10M included Workers requests/mo, up to ~30 s CPU/req, far higher D1 read/write quotas, Workers Logs/observability, unlimited cron triggers.</td></tr>
<tr><td><b>Code/config changes</b></td><td>None required to turn on. Then opportunistically: enable <code>[observability]</code> in <code>wrangler.toml</code>; you may now run heavier cron passes safely.</td></tr>
<tr><td><b>Cost</b></td><td>~$5/mo base + usage above included (verify).</td></tr>
<tr><td><b>Risk / rollback</b></td><td>Very low. Billable overages are the only downside — set a budget alert. Rollback = downgrade to Free.</td></tr>
</table>

## Stage 2 — Paid AI for the hot path

Free Gemini throttling is the first *user-visible* pain (failed onboarding/plan-gen). Move
the primary AI to a paid quota; keep the existing free fallbacks underneath.

<table>
<tr><th>Field</th><th>Detail</th></tr>
<tr><td><b>Trigger</b></td><td>Recurring 429s from Gemini during onboarding/plan-gen (visible in <code>ai_usage</code> as <code>ok=0</code> for kind <code>interview</code>/<code>plan</code>), or fallbacks firing often.</td></tr>
<tr><td><b>What changes</b></td><td>Switch <code>GEMINI_API_KEY</code> to a paid (pay-per-token) project, or front the chain with a small paid OpenRouter credit. The orchestrator (<code>src/ai/index.ts</code>) already tries providers in order with identical input — only the key/quota changes; Workers AI stays as the free safety net.</td></tr>
<tr><td><b>Cost control levers (already in code)</b></td><td><code>GEMINI_LIGHT_MODEL</code> for cheap tasks (interview/coach/nutrition); <code>thinkingBudget: 0</code>; schema-in-prompt to cut retries; <code>ai_usage</code> table to attribute spend by provider/kind/user.</td></tr>
<tr><td><b>Cost</b></td><td>Pay-per-token — scales with active users. Cap with per-user/day rate limits (see Stage 3).</td></tr>
<tr><td><b>Risk / rollback</b></td><td>Low. Rollback = point the key back at the free project; fallbacks keep working.</td></tr>
</table>

## Stage 3 — Efficiency & guardrails (defer scale, don't buy it)

Before scaling out, cut the load. These are code changes, mostly free, that push the next
paid step further away.

<table>
<tr><th>Item</th><th>Change</th><th>Why</th></tr>
<tr><td>Leaderboard cache</td><td>Add a <code>leaderboard_cache</code> table; have the weekly cron compute boards once and have <code>/records</code> read the cache (recompute live only the viewer's own rank).</td><td><code>computeBoards()</code> currently runs aggregate JOINs on every <code>/records</code> tap — the main D1 rows-read driver as users grow.</td></tr>
<tr><td>Per-user AI rate limit</td><td>Track AI calls/user/day (<code>ai_usage</code> already records them) and soft-cap abusive volume with a friendly message.</td><td>Caps Stage-2 token spend; blunts abuse.</td></tr>
<tr><td>Cron fan-out batching</td><td>The hourly cron loops every onboarded user. Batch sends and add small delays to respect Telegram's ~30 msg/s; skip users whose local hour has no scheduled action early.</td><td>Avoids cron CPU growth and Telegram 429s on weekly broadcasts.</td></tr>
<tr><td>Index review</td><td>Confirm indexes cover the leaderboard/report queries (<code>workout_logs(userId,date)</code>, <code>users(competeOptIn)</code>, etc.) as data grows.</td><td>Keeps rows-read and latency down.</td></tr>
<tr><td>Budget alerts</td><td>Set Cloudflare + Google billing alerts.</td><td>No surprise bills once paid tiers are on.</td></tr>
</table>

**Cost:** ~$0 (code only). **Risk:** low; ship behind typecheck + tests as usual.

## Stage 4 — Async & coordination (Queues + Durable Objects)

When broadcasts, trainer notifications, or weekly nudges outgrow a single cron invocation,
or you need precise per-entity coordination/rate-limiting.

<table>
<tr><th>Field</th><th>Detail</th></tr>
<tr><td><b>Trigger</b></td><td>Cron approaching its time budget on the weekly fan-out; Telegram 429s despite batching; need for reliable retries on sends.</td></tr>
<tr><td><b>What changes</b></td><td><b>Cloudflare Queues</b>: cron enqueues per-user nudge/digest jobs; a queue consumer sends them with controlled concurrency + retries. <b>Durable Objects</b> (optional): per-user or per-chat object for exact rate-limiting and session coordination instead of D1 round-trips.</td></tr>
<tr><td><b>Cost (verify)</b></td><td>Queues + Durable Objects are usage-priced on the Workers Paid plan; modest at this scale.</td></tr>
<tr><td><b>Risk / rollback</b></td><td>Medium — new moving parts. Roll out behind a flag; fall back to the inline cron path if the consumer misbehaves.</td></tr>
</table>

## Stage 5 — Media, multi-region & real monitoring

Only if the product expands (storing meal photos, heavier analytics, SLAs).

<table>
<tr><th>Item</th><th>Change</th><th>Trigger</th></tr>
<tr><td>R2 object storage</td><td>Persist meal photos / exports in R2 (S3-compatible, no egress fees) instead of processing transiently.</td><td>A feature needs durable media or large exports.</td></tr>
<tr><td>Analytics Engine / Logpush</td><td>Stream usage + AI metrics out for dashboards (Grafana) and alerting (Sentry/uptime).</td><td>You need trend dashboards and on-call alerting, not just the owner report.</td></tr>
<tr><td>Custom domain</td><td>Move the webhook off <code>*.workers.dev</code> to a custom domain.</td><td>Branding / stability.</td></tr>
<tr><td>D1 read scaling</td><td>Adopt D1 read replication / split analytical reads from the hot path as it matures (verify availability).</td><td>D1 read latency/volume becomes the ceiling even after Stage 3 caching.</td></tr>
</table>

## Metrics to watch (decide upgrades on data, not guesses)

<table>
<tr><th>Signal</th><th>Source</th><th>Acts as trigger for</th></tr>
<tr><td>Workers requests/day, CPU time</td><td>Cloudflare dashboard / Workers Logs</td><td>Stage 1</td></tr>
<tr><td>D1 rows read/written per day</td><td>Cloudflare D1 metrics</td><td>Stage 1, then Stage 3 caching</td></tr>
<tr><td>AI failures by provider/kind</td><td><code>ai_usage</code> table / owner report</td><td>Stage 2</td></tr>
<tr><td>Telegram 429 send errors</td><td>Worker logs (<code>wrangler tail</code>)</td><td>Stage 3 batching → Stage 4 Queues</td></tr>
<tr><td>Cron duration</td><td>Worker logs</td><td>Stage 4</td></tr>
</table>

## Summary

<table>
<tr><th>Stage</th><th>Buy</th><th>Approx cost</th><th>Unlocks</th></tr>
<tr><td>0</td><td>Nothing (current)</td><td>$0</td><td>MVP at small scale</td></tr>
<tr><td>1</td><td>Workers Paid</td><td>~$5/mo + usage</td><td>Headroom on Workers + D1, observability</td></tr>
<tr><td>2</td><td>Paid AI quota</td><td>Pay-per-token</td><td>Reliable onboarding/plan-gen at scale</td></tr>
<tr><td>3</td><td>Code only</td><td>$0</td><td>Caching + caps that defer further spend</td></tr>
<tr><td>4</td><td>Queues / Durable Objects</td><td>Usage-priced</td><td>Reliable async fan-out + coordination</td></tr>
<tr><td>5</td><td>R2 / monitoring / domain</td><td>Usage-priced</td><td>Media, dashboards, HA</td></tr>
</table>

**Principle:** stay on Stage 0 as long as the metrics allow; when something breaks, take the
*single* next stage its trigger points to. Stages 1–2 are the only near-term paid steps for a
growing hobby/early product; Stage 3 (free code work) should always precede Stages 4–5.
