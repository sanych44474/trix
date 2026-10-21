plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

// Firebase is configured per environment: drop google-services.json next to this file to enable
// push (see mobile/README.md). Without it the app builds and runs with push off.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    apply(plugin = libs.plugins.firebase.crashlytics.get().pluginId)
}

// The Worker origin the app talks to, e.g. -Phacklimits.apiBaseUrl=https://api.example.com or the
// same key in ~/.gradle/gradle.properties. Required: an app that silently points nowhere is worse.
val apiBaseUrl = providers.gradleProperty("hacklimits.apiBaseUrl").orNull
    ?: throw GradleException("Set hacklimits.apiBaseUrl (the HTTPS origin of the Worker) - see mobile/README.md")
// HTTPS only, except the emulator's host address for a local `wrangler dev`, which only debug
// builds can reach (src/debug/res/xml/debug_network_security.xml).
require(apiBaseUrl.startsWith("https://") || apiBaseUrl.startsWith("http://10.0.2.2:")) { "hacklimits.apiBaseUrl must be an https:// origin" }
// Google Play requires a privacy policy link inside the app; More shows it once this is set.
val privacyPolicyUrl = providers.gradleProperty("hacklimits.privacyPolicyUrl").orNull ?: ""

// Release signing comes only from the environment (CI secrets or a local shell), never from files
// in the repository. Without it a release build is produced unsigned, which is fine for checking
// that R8 works; Play upload needs the upload key.
val releaseKeystore = System.getenv("HACKLIMITS_KEYSTORE_PATH")
// Play needs a strictly increasing versionCode per upload; CI passes it, local builds default to 1.
val appVersionCode = providers.gradleProperty("hacklimits.versionCode").orNull?.toInt() ?: 1

android {
    namespace = "app.hacklimits.android"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "app.hacklimits"
        minSdk = 26
        // API 36 is the current Google Play target requirement; move to 37 after testing Android 17.
        targetSdk = 36
        versionCode = appVersionCode
        versionName = providers.gradleProperty("hacklimits.versionName").orNull ?: "0.1.0"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "PRIVACY_POLICY_URL", "\"$privacyPolicyUrl\"")
        // Crash reports only from real installs; debug builds keep crashes on the developer's screen.
        manifestPlaceholders["crashlyticsEnabled"] = "true"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // How an install gets new versions. "direct" (the APK testers and the website hand out) downloads
    // them from Cloudflare itself and asks the user to install; "play" leaves updates to Google Play,
    // whose policy forbids self-updating apps (and the install-packages permission that needs).
    flavorDimensions += "store"
    productFlavors {
        create("direct") {
            dimension = "store"
            isDefault = true
        }
        create("play") {
            dimension = "store"
        }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("HACKLIMITS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("HACKLIMITS_KEY_ALIAS")
                keyPassword = System.getenv("HACKLIMITS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["crashlyticsEnabled"] = "false"
        }
        release {
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.koin.android)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.androidx.work)
    implementation(libs.androidx.health.connect)
    implementation(libs.firebase.crashlytics)
    implementation(libs.play.app.update)
    debugImplementation(libs.leakcanary)
}
