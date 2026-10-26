# ADR-0011: the "rest is over" notification has one owner per rest: the client that started it

- Status: accepted
- Date: 2026-10-26
- Builds on [ADR-0002](0002-no-do-rest-timer.md)

## Context

A rest that ends can be announced two ways:

- **Server timer.** `POST /api/v2/workout/rest` writes a row to `v2_rest_timers`, and the
  minute-cron (`src/scheduler.ts`) sends a Telegram "rest is over" message (ADR-0002). This is the
  only way the Mini App can notify, because a Telegram webview can't set an alarm on the phone.
- **Device alarm.** The native Android app schedules a local notification (`RestAlarm`) for the
  exact second the rest ends. It works offline and is up to a minute earlier than the cron.

When both fire for the same rest, the user gets two notifications: one on the phone and one in
the Telegram chat. Android builds up to 0.3.1 armed the server timer and the local alarm together.
#96 stopped the app from arming the server timer, but that fix only reaches people who update.
The server still accepted the request from every older APK, so the duplicate kept arriving.

The rule depended on every client release behaving correctly. A self-updating APK can't promise
that; old builds stay installed for weeks.

## Decision

The client that starts a rest owns its notification, and **the server enforces this**.

- A request from the native app (`isNativeClient`: `X-Client: native` and no `Origin`, sent on
  every request since the first native build, #87) never schedules a Telegram message. On
  `POST /api/v2/workout/rest` the server clears any pending server timer for the account and
  answers `{ ok: true, delivery: "device" }`; the app's local alarm is the notification.
- A request from the Mini App schedules the server timer as before (`delivery: "telegram"`).
- `DELETE /api/v2/workout/rest` still clears the server timer for any client.

## Options considered

### A. Leave it to the clients (the state after #96)

| Dimension | Assessment |
|---|---|
| Complexity | Low: no server change |
| Covers old APKs | No: every build up to 0.3.1 keeps duplicating until it updates |
| Precision | Device alarm, to the second |

### B. Server owns every notification: FCM push for the app, Telegram for the Mini App; drop the local alarm

| Dimension | Assessment |
|---|---|
| Complexity | Medium: per-rest delivery channel, FCM sends from the cron |
| Covers old APKs | No: old APKs still ring their own local alarm as well |
| Precision | Up to 60 s late (minute-cron, ADR-0002); needs network at the end of the rest |

### C. Client owns it, server enforces it (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Low: one branch in the rest route |
| Covers old APKs | Yes, from the deploy, with no app update |
| Precision | App: device alarm, to the second. Mini App: unchanged |

## Trade-off analysis

B makes the server the single sender, which sounds cleaner. But it trades a to-the-second,
offline-capable alarm for a minute-late push that needs network, and it still doesn't fix
installed APKs. C keeps the best channel for each client and closes the gap for every installed
version at once, because the decision moves to the one component that ships on deploy.

## Consequences

- One notification per rest, on every installed app version, once the Worker is deployed.
- A rest started in the app is no longer announced in Telegram. If the phone is off at the end of
  the rest, nothing arrives; that is the same as any local alarm, and acceptable for a rest that is
  minutes long.
- Starting a rest in the app cancels a Mini App rest still pending for the same account. Only the
  rest the user is doing now gets announced.
- The unused `WorkoutApi.startRestTimer` was removed from the app, so it can't be called again.
- Revisit if an iOS app ships (it sends the same header) or if the Mini App gains a device-level
  notification.
