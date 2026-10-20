plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

// Firebase is configured per environment: drop google-services.json next to this file to enable
// push (see mobile/README.md). Without it the app builds and runs with push off.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

// The Worker origin the app talks to, e.g. -Phacklimits.apiBaseUrl=https://api.example.com or the
// same key in ~/.gradle/gradle.properties. Required: an app that silently points nowhere is worse.
val apiBaseUrl = providers.gradleProperty("hacklimits.apiBaseUrl").orNull
    ?: throw GradleException("Set hacklimits.apiBaseUrl (the HTTPS origin of the Worker) - see mobile/README.md")
require(apiBaseUrl.startsWith("https://")) { "hacklimits.apiBaseUrl must be an https:// origin" }

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
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
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
}
