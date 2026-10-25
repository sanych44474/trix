# mobile/: native app rules

Kotlin Multiplatform. The modules are described in `README.md`:
- `shared`: Compose UI, Ktor client, view models, Koin wiring, strings.
- `androidApp`: Android entry point, Credential Manager, Keystore session, FCM.

It talks to the same Worker API and accounts as the Mini App.

## Verifying
- There is no Android SDK in Claude's container, so Gradle can't run here.
- The check is the "Mobile" CI workflow. It runs:
  ```
  :shared:testAndroidHostTest :androidApp:lintDirectDebug :androidApp:assembleDirectDebug :androidApp:assemblePlayDebug
  ```
- Push, then read the job log. If a test fails, reproduce the reasoning from the log before changing code.

## Rules
- **`commonTest` targets iOS too.** No JVM-only APIs there: no `synchronized`, `java.*` or `Thread`. Use coroutines (`CompletableDeferred`, `Mutex`).
- **Ktor MockEngine runs on its own thread, outside the test scheduler.** `advanceUntilIdle()` does not wait for it. Await a `CompletableDeferred` completed in the handler, with a bounded real-time poll.
- **Strings live in `composeResources`.** Add every key in both `values/` (en, default) and `values-uk/`.
- **Screens must scroll.** A testers' phone is small: a tall Column needs `verticalScroll`, and button rows need `weight(1f)` and `maxLines = 1`.
- **Two build variants.** Play and direct-download update differently. Keep both building.
- **Shared behavior lives on the server.** Plans, progression, rest timers and notifications belong to the Worker. Don't fork that logic into Kotlin. If the bot also sends something (like a rest-over ping), make sure the app doesn't cause a duplicate.
- **No secrets in the repo.** Signing keys, `google-services.json` secrets and API base URLs for prod stay out of it. `hacklimits.apiBaseUrl` comes from Gradle properties.
- **Testers need a build.** After a merged fix they need a new APK. Remind the owner.
