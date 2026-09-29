# Reddit

Read each subreddit's rules first (self-promotion days, flair, the "10% rule"). Say you're the
maker, post one subreddit per day, stay in the comments, and never paste the same text twice.
Big fitness subs (r/Fitness, r/bodyweightfitness) generally ban app promotion — don't post there.

## r/SideProject

**Title:** I built a free AI personal trainer that lives in Telegram (open source, runs on free tiers)

> Every fitness app I tried waited for me to open it, and I stopped in week two. So I built
> **trix**, a Telegram bot + Mini App that messages you first on training days.
>
> - 2-minute button interview → a plan around your days, equipment and injuries
> - one-tap set logging; it decides when to add weight and flags plateaus/deloads
> - a body map with each muscle's weekly load, recovery and 12-week trend; plans fix their own
>   imbalances before you see them
> - technique pictures per exercise + a form check from a video of your set
> - macros from a photo of your plate
>
> Stack: Cloudflare Workers + D1, React Mini App, a fallback chain of free AI tiers — so it costs
> $0 to run and is free to use. MIT on GitHub: https://github.com/sanych44474/trix
>
> Try it: https://t.me/hack_limits_bot — feedback very welcome, especially what's confusing.

## r/opensource (or r/selfhosted — only if they allow it; it's self-hostable on Cloudflare)

**Title:** trix — an open-source AI fitness coach (Telegram bot + Mini App) that runs on Cloudflare's free tier

> Sharing a project I've been building: an AI personal trainer as a Telegram bot + Mini App,
> MIT-licensed. Workers + D1 backend, React Mini App, OpenAPI-typed API, ~1,000 tests, and an AI
> provider fallback chain (Gemini → Groq → OpenRouter → Workers AI) so it keeps working on free
> tiers.
>
> It plans workouts around your days/equipment/injuries, runs progression, shows a per-muscle
> body map and recovery, checks form from a video and counts macros from a photo.
>
> Repo: https://github.com/sanych44474/trix · Live bot: https://t.me/hack_limits_bot
> Happy to answer questions about running AI features at $0.

## r/Telegram

**Title:** Made a Telegram Mini App that works as a free personal trainer

> A bot + Mini App: plan, set logging, rest timer with a Telegram ping, a muscle map, macros from
> a photo, and shareable story cards. Uses MainButton, stories, home-screen shortcut and Stars
> (only for voluntary support). https://t.me/hack_limits_bot — would love feedback on the Mini App UX.

## r/HomeGym or r/homeworkouts (check rules)

**Title:** Free tool that builds a home workout plan around the equipment you actually have

> Tell it what you have (nothing, dumbbells, bands, a bar) and how many days you can train; it
> writes the plan, shows technique pictures for each exercise, tracks progression and swaps
> exercises when today's setup is different. Free, in Telegram: https://t.me/hack_limits_bot
> (I'm the maker — honest feedback welcome.)
