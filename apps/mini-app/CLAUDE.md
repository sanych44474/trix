# apps/mini-app/: Telegram Mini App rules

Preact + Vite. It runs inside Telegram's webview and talks to `src/webapp/` (`/api/v2/...`).

## Verifying
- Typecheck: `npm run typecheck:webapp`.
- Build: `npm run build:webapp:all`.
- Logic tests live in `test/mini-app-*.test.ts` (run by `npm test`).

## Rules
- **Shared code goes through `src/logic/`.** Components never import `../../src/...` directly. When a codemod or refactor rewrites Mini App imports, revert that part.
- **Strings live in the catalogs `src/i18n/en.ts` and `src/i18n/uk.ts`;** `src/i18n.ts` is the lookup module that loads them. `uk` must cover every `en` key.
- **Mind the phone keyboard.** When a text field has focus, fixed bottom bars (`.train-dock` in `train/SaveDock.tsx`, MainButton) must hide, or they cover what the user types. Check every new input with the keyboard open.
- **Use Telegram's native pieces where they exist:** MainButton, BackButton, haptics, DeviceStorage (see `telegram.ts`). Degrade gracefully outside Telegram.
- **Logging must work offline.** Workout saves go through the offline queue (`logic/offlineSaves.ts`). Don't bypass it.
- **Same backend as the bot and Android.** A payload change here is a payload change for all three clients.
