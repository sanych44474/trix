plugins {
    id("com.android.application")
}

android {
    namespace = "app.trix.android"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "app.trix.android"
        minSdk = 24
        // API 36 is Google's current Play submission requirement. Move to API 37 after
        // the Android 17 behavior changes have been tested on supported devices.
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.19.1")
    implementation("androidx.fragment:fragment:1.9.1")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
}
