# Health Connect wiring (Android)

Steps are read on-device with Health Connect and posted to the Worker as a daily `steps` log
(`POST /api/v2/log`). Nothing is written back to Health Connect.

The code is in `src/main/kotlin/app/hacklimits/android/health/HealthConnectSync.kt.txt`. It is
named `.kt.txt` so the Android build ignores it until the dependency below is added. Rename it to
`HealthConnectSync.kt` when you add the dependency.

Reference: <https://developer.android.com/health-and-fitness/health-connect/get-started> (the
manifest entries, `<queries>` package and privacy-policy activity alias below come from that page).

## 1. Dependency

`androidApp/build.gradle.kts`, `dependencies { }`. Use the version catalog, adding this to
`gradle/libs.versions.toml` first:

```toml
# [versions]
androidx-health-connect = "1.1.0"
# [libraries]
androidx-health-connect = { module = "androidx.health.connect:connect-client", version.ref = "androidx-health-connect" }
```

```kotlin
implementation(libs.androidx.health.connect)
```

Or directly: `implementation("androidx.health.connect:connect-client:1.1.0")`.

1.1.0 is the latest stable release on Google Maven. The newest build, `1.2.0-alpha06`, is an alpha, and
the Health Connect docs show it in their snippet. Stay on 1.1.0 unless you want the alpha.

## 2. AndroidManifest.xml

Inside `<manifest>`, next to the other `<uses-permission>` entries:

```xml
<uses-permission android:name="android.permission.health.READ_STEPS" />
```

Inside `<manifest>`, at the same level as `<application>`:

```xml
<queries>
    <package android:name="com.google.android.apps.healthdata" />
</queries>
```

Inside `<application>`. The privacy-policy screen is required by Health Connect. Create
`PermissionsRationaleActivity` (an Activity that shows the app's privacy policy) before you add these:

```xml
<!-- Android 13 and lower -->
<activity
    android:name=".PermissionsRationaleActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
    </intent-filter>
</activity>

<!-- Android 14 and higher -->
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".PermissionsRationaleActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
    <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
        <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
    </intent-filter>
</activity-alias>
```

## 3. Koin binding (Android)

In `HackLimitsApp.kt`, in the Android `module { }` next to `AppPlatform`, `SessionStore` and the
others. Add the imports shown:

```kotlin
import app.hacklimits.android.health.HealthConnectSync
import app.hacklimits.shared.integrations.HealthSync
import app.hacklimits.shared.integrations.integrationsModule
import org.koin.android.ext.koin.androidContext

// inside module { }
single<HealthSync> { HealthConnectSync(androidContext()) }
```

Also add `integrationsModule` to the `modules(...)` list next to `sharedModule(BuildConfig.API_BASE_URL)`.
Do not bind `HealthSync` in the shared module. Other platforms bind `NoHealthSync` in their own module.

## 4. Permission launcher (MainActivity)

The screen calls `onRequestHealthPermission`. The Activity must own the launcher:

```kotlin
private val healthPermission = registerForActivityResult(HealthConnectSync.permissionContract()) { }

// where App(...) is composed, pass:
onRequestHealthPermission = { healthPermission.launch(HealthConnectSync.PERMISSIONS) }
```

`IntegrationsScreen` re-checks the grant on every resume, so the result callback can stay empty.

## 5. Notes

- Health Connect needs API 26 or higher. `minSdk` is 26, so no extra guard is needed.
- On Android 13 and lower the Health Connect app must be installed. `available()` returns false when
  it is missing or needs an update.
- Google Play requires a Health Connect permissions declaration before a release that requests health
  permissions. Check the current Play Console requirement before you submit.
