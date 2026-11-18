# Health Connect wiring (Android)

Steps are read on-device with Health Connect and posted to the Worker as a daily `steps` log
(`POST /api/v2/log`). Nothing is written back to Health Connect.

Everything below is already wired in the repository. This page says where each piece is, so you can
check or change it.

The code is in `src/main/kotlin/app/hacklimits/android/health/HealthConnectSync.kt`. It is compiled
with the app. The same folder holds `PermissionsRationaleActivity.kt` and `StepSensor.kt` (the
phone's own step counter, used as a fallback when nothing syncs steps into Health Connect).

Reference: <https://developer.android.com/health-and-fitness/health-connect/get-started> (the
manifest entries, `<queries>` package and privacy-policy activity alias below come from that page).

## 1. Dependency

Present in `gradle/libs.versions.toml`:

```toml
# [versions]
androidx-health-connect = "1.1.0"
# [libraries]
androidx-health-connect = { module = "androidx.health.connect:connect-client", version.ref = "androidx-health-connect" }
```

and in `androidApp/build.gradle.kts`, `dependencies { }`:

```kotlin
implementation(libs.androidx.health.connect)
```

1.1.0 was the latest stable release on Google Maven when the catalog was last checked. The Health
Connect docs show an alpha (`1.2.0-alpha06` at the time of writing); stay on stable unless you want it.

## 2. AndroidManifest.xml

`src/main/AndroidManifest.xml` has these entries.

Inside `<manifest>`, with the other `<uses-permission>` entries:

```xml
<uses-permission android:name="android.permission.health.READ_STEPS" />
```

The same file also declares `ACTIVITY_RECOGNITION`, used only by the step-counter fallback.

Inside `<manifest>`, at the same level as `<application>`, the `<queries>` block lists the Health
Connect package (next to the speech-recognition intent):

```xml
<queries>
    <package android:name="com.google.android.apps.healthdata" />
    ...
</queries>
```

Inside `<application>`. Health Connect requires a privacy-policy screen. `PermissionsRationaleActivity`
opens the privacy policy in the browser (`BuildConfig.PRIVACY_POLICY_URL`, or `<API base URL>/privacy.html`
when that is blank) and closes:

```xml
<activity
    android:name=".health.PermissionsRationaleActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
    </intent-filter>
</activity>
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".health.PermissionsRationaleActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
    <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
        <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
    </intent-filter>
</activity-alias>
```

The first `<activity>` serves Android 13 and lower, the alias serves Android 14 and higher.

## 3. Koin binding (Android)

`src/main/kotlin/app/hacklimits/android/HackLimitsApp.kt` binds it in the Android `module { }`:

```kotlin
single<HealthSync> { HealthConnectSync(get()) }
```

with the imports `app.hacklimits.android.health.HealthConnectSync` and
`app.hacklimits.shared.integrations.HealthSync`. `integrationsModule` is not listed in
`HackLimitsApp.kt`: `sharedModule(BuildConfig.API_BASE_URL)` already includes it. `HealthSync` is
deliberately not bound in the shared module. Other platforms bind `NoHealthSync` in their own module.

## 4. Permission launcher (MainActivity)

The screen calls `onRequestHealthPermission`, and the Activity owns the launcher. In
`src/main/kotlin/app/hacklimits/android/MainActivity.kt`:

```kotlin
private val healthPermission = registerForActivityResult(HealthConnectSync.permissionContract()) {}

// where App(...) is composed:
onRequestHealthPermission = { healthPermission.launch(HealthConnectSync.PERMISSIONS) },
```

`IntegrationsScreen` re-checks the grant on every resume, so the result callback stays empty.

## 5. Notes

- Health Connect needs API 26 or higher. `minSdk` is 26, so no extra guard is needed.
- On Android 13 and lower the Health Connect app must be installed. `available()` returns false when
  it is missing or needs an update.
- Disconnecting sets a local flag and revokes the grants, because Health Connect keeps reporting a
  revoked grant until the app restarts.

## 6. Outside the repository

- Google Play requires a Health Connect permissions declaration before a release that requests health
  permissions. The app requests `READ_STEPS`. Check the current Play Console requirement before you
  submit; see `../PLAY_CONSOLE.md` for the answers already recorded.
