# trix for Android

Native Android app for the project's `/app-v2` web app. It uses Android WebView, preserves the
Worker's secure session cookie, and supports native Google sign-in, a one-time Telegram bot login
link, and passwordless email sign-in. Existing Telegram Mini App users keep their signed login.

## Configure Google and Telegram sign-in

1. In Google Cloud Console, configure the OAuth consent screen and create two OAuth client IDs in
   the same project:
   - An **Android** client for package `app.trix.android`, using the SHA-1 signing fingerprint for
     the build you install. Get it from Android Studio's Gradle `signingReport` task; add the
     release or Play App Signing fingerprint before distributing a release.
   - A **Web application** client for the Worker. Store this Web client ID as a Worker secret:

   ```powershell
   npx wrangler secret put GOOGLE_CLIENT_ID
   ```

   Paste the Web client ID when Wrangler prompts for the value. Android Credential Manager uses
   it as the server audience; the Worker verifies the signed token and its one-time nonce.
2. Set `BOT_USERNAME` in the Worker's `[vars]` in `wrangler.toml` to the bot's username without
   `@`. The Telegram button creates a one-time `t.me` link; the user opens the bot and taps **Start**.
3. Apply migrations `0098_email_auth.sql`, `0099_provider_auth.sql`, and
   `0100_telegram_login_proof.sql` to the project's D1 database before deploying. They add
   persistent sessions, Google identity mappings, short-lived sign-in challenges, and a private
   browser proof for completing Telegram sign-in. That proof stays in the active app page and is
   never included in the Telegram link.

   Apply any pending migrations to the production database with:

   ```powershell
   npx wrangler d1 migrations apply trix --remote
   ```

Google sign-in runs through Android Credential Manager, outside the embedded WebView. The Google
button appears in the Android app after `GOOGLE_CLIENT_ID` is configured. SMS login is not included:
Firebase phone verification requires a billing-enabled project for production SMS.

## Configure email sign-in

Before using email login, configure the Worker:

1. Verify a sender domain/address with [Resend](https://resend.com) and set `AUTH_EMAIL_FROM` in
   `wrangler.toml` to that verified sender, for example `trix <login@example.com>`.
2. Add the provider key and a unique random secret of at least 32 characters:

   ```powershell
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put AUTH_SECRET
   ```

   For local development, add those values to `.dev.vars` instead. Never commit that file.
3. Apply migrations `migrations/0098_email_auth.sql`, `migrations/0099_provider_auth.sql`, and
   `migrations/0100_telegram_login_proof.sql`, then deploy the Worker using the project's normal
   deployment flow.

## Run on Android

- Android Studio with Android SDK Platform 37, Build Tools 37.0.0, and Platform Tools 37.0.1
- JDK 17 (included with current Android Studio releases)
- Gradle 9.8.2 (the checked-in wrapper downloads the pinned distribution and verifies its SHA-256)
- A deployed HTTPS URL for this project's Cloudflare Worker

The project compiles against Android 17 (API 37). It currently targets API 36, which meets the
Google Play submission requirement; switch the target to API 37 after completing its behavior-change
checks on supported devices.

Open the `android` directory in Android Studio, sync Gradle, and run the `app` configuration on a
device or emulator with Google Play services. On first launch, enter the Worker origin, such as
`https://trix.example.workers.dev`; the app saves it in private device preferences and opens
`/app-v2/`. Use the toolbar menu to change the server later.

The app accepts only HTTPS Worker origins. It keeps the app on that origin inside WebView and opens
other web links in the device browser. The sign-in cookie is HttpOnly, Secure, and scoped to the
Worker host. Android's file picker handles app photo uploads.

## Build APK

From the repository root, build the debug APK with the pinned wrapper:

```powershell
.\android\gradlew.bat -p android :app:assembleDebug
```

On macOS or Linux, use `sh android/gradlew -p android :app:assembleDebug`. The first build
downloads Gradle 9.8.2 and checks the published distribution SHA-256. Android Studio can run the
same Gradle task after syncing the `android` directory.

In Android Studio, choose **Build > Generate App Bundles or APKs > Generate APKs**. The debug APK
appears under `app/build/outputs/apk/debug/`. For distribution, use **Generate Signed Bundle or
APK** and sign a release build with your Android signing key.

## Architecture

```mermaid
flowchart LR
    A[trix Android app] -->|HTTPS WebView| B[/app-v2/ React app]
    B -->|Google token, Telegram link, or email code| C[Cloudflare Worker]
    C --> D[(D1 accounts and sessions)]
    C -->|send code| E[Resend]
    C -->|verify ID token signature| G[Google signing keys]
    F[Telegram Mini App] -->|signed initData| C
    H[Telegram bot] -->|confirm one-time login link| C
```
