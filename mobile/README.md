# Hack Limits — native app

Kotlin Multiplatform app for Android (iOS later) that talks to the same Cloudflare Worker and the
same accounts as the Telegram Mini App. The two clients live side by side: the Mini App keeps
serving Telegram users, this app serves people who sign in with Google, email or Telegram.

<table>
  <tr><th>Module</th><th>What lives there</th></tr>
  <tr><td><code>shared</code></td><td>Compose Multiplatform UI, Ktor client, view models, Koin wiring, UA/EN strings (<code>composeResources</code>).</td></tr>
  <tr><td><code>androidApp</code></td><td>Android entry point: Credential Manager (Google), Keystore-encrypted session, FCM push, manifest.</td></tr>
</table>

Stack: Kotlin 2.4, Compose Multiplatform 1.12 + Material 3, Ktor 3, kotlinx.serialization, Koin 4,
AGP 9.4 (KMP library plugin), Gradle 9.8 (wrapper pinned by SHA-256). Versions live in
`gradle/libs.versions.toml`.

## Build

Requirements: JDK 17+, Android SDK with platforms 36 and 37.

```powershell
cd mobile
.\gradlew.bat -Phacklimits.apiBaseUrl=https://<your-worker-host> :androidApp:assembleDebug
.\gradlew.bat :shared:testAndroidHostTest
```

`hacklimits.apiBaseUrl` is required (the HTTPS origin of the Worker). Put it in
`~/.gradle/gradle.properties` to avoid typing it. The debug APK lands in
`androidApp/build/outputs/apk/debug/`.

## How the app authenticates

Every request sends `X-Client: native`; a successful sign-in then returns the session token in the
response body (the web only ever gets an HttpOnly cookie). The token is AES-GCM encrypted with a
non-exportable Android Keystore key and sent as `Authorization: Bearer`. App data is excluded from
backup and device transfer. A 401 signs the app out.

- **Google**: Credential Manager with the server's Web client ID as audience and a one-time nonce.
  In Google Cloud, add an **Android** OAuth client for package `app.hacklimits` with the SHA-1 of
  each signing key (debug, upload, Play App Signing).
- **Telegram**: the app shows a 4-digit code and opens the bot; the bot shows the same code and the
  sign-in completes only after "Confirm" is tapped there.
- **Email**: one-time 6-digit code.

## Push notifications (Firebase project `trix-9c6e8`)

1. In the Firebase console add an Android app with package `app.hacklimits`, download
   `google-services.json` and put it at `mobile/androidApp/google-services.json` (gitignored).
   Without it the app builds and runs with push off.
2. Give the Worker the service-account key as a secret. Keep the key file **outside** the repository
   and never paste it anywhere:

   ```powershell
   npx wrangler secret put FCM_SERVICE_ACCOUNT < C:\path\outside\repo\service-account.json
   ```

3. Apply migration `0102_push_devices.sql` with the normal migration flow.

Reminders for accounts without a Telegram chat then arrive as push notifications on the
"Reminders" channel.

## Release signing

Never commit keystores. Sign release builds from Android Studio (**Generate Signed App Bundle**) or
CI with credentials from the environment; `*.jks`, `*.keystore` and `keystore.properties` are
gitignored.
