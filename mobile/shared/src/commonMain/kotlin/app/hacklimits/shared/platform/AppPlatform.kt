package app.hacklimits.shared.platform

/** Facts only the platform knows. */
interface AppPlatform {
    /** "uk" or "en": the app's two languages; anything else falls back to English. */
    val language: String
    val appVersion: String
    /** The store build number the update gate compares against; 0 when unknown (never gated). */
    val versionCode: Int get() = 0
    /** "android" or "ios", as the push API expects. */
    val pushPlatform: String
    /** Shown in More and required by Google Play; null hides the link until it is configured. */
    val privacyPolicyUrl: String?
}
