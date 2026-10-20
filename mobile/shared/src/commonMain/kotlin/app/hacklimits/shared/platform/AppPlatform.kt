package app.hacklimits.shared.platform

/** Facts only the platform knows. */
interface AppPlatform {
    /** "uk" or "en": the app's two languages; anything else falls back to English. */
    val language: String
    val appVersion: String
    /** "android" or "ios", as the push API expects. */
    val pushPlatform: String
    /** Shown in More and required by Google Play; null hides the link until it is configured. */
    val privacyPolicyUrl: String?
}
