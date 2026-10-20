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

## Release build

Never commit keystores (`*.jks`, `*.keystore` and `keystore.properties` are gitignored). The release
signing key comes only from the environment:

```powershell
$env:HACKLIMITS_KEYSTORE_PATH = "C:\path\outside\repo\upload.jks"
$env:HACKLIMITS_KEYSTORE_PASSWORD = "..."; $env:HACKLIMITS_KEY_ALIAS = "upload"; $env:HACKLIMITS_KEY_PASSWORD = "..."
.\gradlew.bat -Phacklimits.apiBaseUrl=https://<worker> -Phacklimits.privacyPolicyUrl=https://<policy> -Phacklimits.versionCode=2 :androidApp:bundleRelease
```

Without those variables the release build is unsigned (useful to check that R8 shrinking works).
Upload the `.aab` from `androidApp/build/outputs/bundle/release/`; Play App Signing holds the app
signing key, this is only the upload key. Raise `hacklimits.versionCode` for every upload.

## Google Play launch checklist

<table>
  <tr><th>Requirement</th><th>Status</th></tr>
  <tr><td>Target API 36 (required for new apps from 2026-08-31)</td><td>Done: <code>targetSdk = 36</code>.</td></tr>
  <tr><td>In-app account deletion</td><td>Done: More → Delete account (two confirmations), server erases the account and every linked row (tested on real D1).</td></tr>
  <tr><td>Web page for deletion requests</td><td>Done: <code>/account-deletion.html</code> on the Worker. Put its URL in the Data safety form.</td></tr>
  <tr><td>Privacy policy linked in the listing and in the app</td><td><b>Owner:</b> write and publish the policy, then build with <code>-Phacklimits.privacyPolicyUrl=…</code> (More shows the link).</td></tr>
  <tr><td>Data safety form</td><td><b>Owner:</b> declare personal info (email, name), health and fitness (workouts, body weight, nutrition, check-ins), photos, app activity; encrypted in transit; deletion available.</td></tr>
  <tr><td>Health apps declaration</td><td><b>Owner:</b> required for every app; this one is "Activity and fitness" / "Nutrition and weight management".</td></tr>
  <tr><td>Notifications permission (Android 13+)</td><td>Done: asked only after sign-in; nothing is posted without it.</td></tr>
  <tr><td>Closed test before production (personal developer accounts)</td><td><b>Owner:</b> at least 12 testers opted in for 14 days.</td></tr>
  <tr><td>Firebase / push</td><td><b>Owner:</b> <code>google-services.json</code> locally and the <code>FCM_SERVICE_ACCOUNT</code> Worker secret.</td></tr>
  <tr><td>Google sign-in</td><td><b>Owner:</b> Android OAuth client with the SHA-1 of the upload key and of the Play App Signing key.</td></tr>
</table>
