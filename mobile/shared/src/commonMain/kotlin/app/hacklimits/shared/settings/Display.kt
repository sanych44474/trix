package app.hacklimits.shared.settings

import app.hacklimits.shared.data.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Device-local display preferences (the Mini App's theme.ts, plus a system/light/dark choice). */
enum class ThemeMode { SYSTEM, LIGHT, DARK }
enum class Accent { GREEN, RED }
enum class ResolvedTheme { LIGHT, DARK, CONTRAST }

data class DisplayPrefs(
    val mode: ThemeMode = ThemeMode.SYSTEM,
    val accent: Accent = Accent.GREEN,
    val highContrast: Boolean = false,
) {
    /** High contrast wins over the chosen scheme; SYSTEM follows the device. */
    fun resolvedTheme(systemDark: Boolean): ResolvedTheme = when {
        highContrast -> ResolvedTheme.CONTRAST
        mode == ThemeMode.SYSTEM -> if (systemDark) ResolvedTheme.DARK else ResolvedTheme.LIGHT
        mode == ThemeMode.LIGHT -> ResolvedTheme.LIGHT
        else -> ResolvedTheme.DARK
    }

    /** The red accent applies to light and dark; high contrast keeps its fixed colours. Null = default green. */
    fun effectiveAccent(): Accent? = if (accent == Accent.RED && !highContrast) Accent.RED else null
}

/** Parses the stored values; anything unknown falls back to the default. */
fun parseDisplayPrefs(mode: String?, accent: String?, contrast: String?): DisplayPrefs = DisplayPrefs(
    mode = ThemeMode.entries.firstOrNull { it.name.lowercase() == mode } ?: ThemeMode.SYSTEM,
    accent = if (accent == "red") Accent.RED else Accent.GREEN,
    highContrast = contrast == "1",
)

/** Holds the display preferences and persists them in the platform key-value store. Call [load] once
 * at start; the lead wires [prefs] into HackLimitsTheme. */
class DisplayPreferences(private val store: KeyValueStore) {
    private val state = MutableStateFlow(DisplayPrefs())
    val prefs: StateFlow<DisplayPrefs> = state

    suspend fun load() {
        state.value = parseDisplayPrefs(store.get(KEY_MODE), store.get(KEY_ACCENT), store.get(KEY_CONTRAST))
    }

    suspend fun update(next: DisplayPrefs) {
        store.put(KEY_MODE, next.mode.name.lowercase())
        store.put(KEY_ACCENT, next.accent.name.lowercase())
        store.put(KEY_CONTRAST, if (next.highContrast) "1" else "0")
        state.value = next
    }

    private companion object {
        const val KEY_MODE = "ac_theme_mode"
        const val KEY_ACCENT = "ac_accent"
        const val KEY_CONTRAST = "ac_contrast"
    }
}
