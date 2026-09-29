# Bot profile (@BotFather)

## Set automatically

`node scripts/setup-telegram.mjs <worker-url>` sets these through the Bot API (the texts live in
that script; English is the default, Ukrainian for uk clients):

- **Description** — the text a new user sees in the empty chat before tapping Start.
- **Short description** — shown on the bot's profile and when the bot is shared.

## Set by hand in @BotFather

Open @BotFather → `/mybots` → the bot → **Edit Bot**:

| Setting | Value |
|---|---|
| **Edit Botpic** | [img/avatar-512.png](img/avatar-512.png) |
| **Edit Description Picture** | [img/botfather-description-640x360.png](img/botfather-description-640x360.png) (shown above the description in the empty chat) |
| **Edit Name** | `trix — AI-тренер` (the name is searchable in Telegram; keep "AI-тренер" in it) |

Mini App (optional, for Mini App catalogs): **Bot Settings → Configure Mini App → Enable**, with
the same `/app-v2` URL the menu button uses, and the short name `app`, so
`t.me/hack_limits_bot/app` opens the app directly.

## If you prefer to paste the texts by hand

Short description (≤120):

> Безкоштовний AI-тренер: програма під твої дні й обладнання, прогресія, КБЖУ за фото. 💪

Description (≤512):

> 🏋️ trix — безкоштовний AI-тренер у Telegram.
>
> • Програма під твої дні, обладнання й травми — вдома чи в залі
> • Запис підходів в один дотик, сам вирішує, коли додати вагу
> • Карта тіла: навантаження, відновлення і тренд кожного м'яза
> • Фото техніки й перевірка техніки за відео
> • КБЖУ за фото тарілки
>
> Без підписки й реклами. Натисни «Старт» — 2 хвилини інтерв'ю, і план готовий.
