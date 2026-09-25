# ADR-0008: squad creation and management stay in the bot

- Status: accepted
- Date: 2026-09-22

## Context

`docs/feature-audit-v2.md` has listed "squad creation/management stays bot-only" as a Mini App
gap since the v2 cutover, sitting next to genuine gaps like whole-day plan editing. Treating it
as the same kind of item is what kept it on the list: it reads as "not built yet", and the fix
looks like ordinary work nobody has picked up.

It is not that. **A squad *is* a Telegram group chat.** Its primary key is the group's `chatId`:

- `upsertSquad(ctx.db, chatId, title, user._id)` (`src/bot/squad.ts:156`) is the only creation
  path, reached from `handleGroupUpdate` — a command parsed out of a message **sent inside the
  group**, where `ctx.chat.id` and `ctx.chat.title` exist.
- `v2_squads` is keyed on that `chatId`, and `squadsForUser` derives membership from it
  (`src/webapp/squadApi.ts` takes no client-supplied squad id for exactly this reason).
- The title is not user-entered; it mirrors the Telegram group's own title.

A Mini App webview authenticates one **user** through `initData`. It has no group context, and
no API by which it could acquire one. So "create a squad from the app" is not a feature that is
missing — it is a sentence that does not resolve to anything the platform can express. The same
goes for renaming (the name is the group's) and for adding members (membership is group
membership).

## Decision

Squad creation and management stay bot-only, permanently, for structural reasons rather than
effort. `docs/feature-audit-v2.md` stops listing it as a gap and points here.

The Mini App keeps the read-only squad view it already has — standings computed by the same
`squadWeek`/`squadMedal` domain functions the bot's `/squadboard` uses, scoped to the caller's
own memberships.

## Consequences

- One fewer phantom item on the roadmap. This matters more than it sounds: a backlog that mixes
  real gaps with impossible ones trains people to skim it.
- If a squad ever stops being a group chat — say a squad you join by invite code, with its own
  identity independent of Telegram — this decision is void, because its entire premise is that
  the squad's identity comes from the chat. That would be a new feature with a new data model,
  not "finally building the missing screen".
- **One thing here genuinely could move and deliberately has not:** *leaving* a squad is a
  membership-row delete and needs no group context. It is not built because the bot does not
  offer it either, so adding it to the app alone would put the only exit behind the surface the
  user is less likely to be in. If it is wanted, it should land on both surfaces together.

## Related

- [ADR-0007](0007-photo-of-food-stays-in-the-bot.md) — same shape of finding: an item sat on the
  gap list under a stated reason ("no upload route") that turned out to be false, and stayed
  bot-only for a different and better reason. Two of these in one pass is a signal that the gap
  list needs each entry's *reason* re-checked, not just its status.
