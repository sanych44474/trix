package app.hacklimits.shared.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import app.hacklimits.shared.settings.Accent
import app.hacklimits.shared.settings.DisplayPrefs
import app.hacklimits.shared.settings.ResolvedTheme

/** App-level accessibility preference consumed by animated screens and effects. */
internal val LocalReducedMotion = compositionLocalOf { false }

// Brand tokens shared with the Mini App: near-black ground, electric-lime accent.
private val Lime = Color(0xFFA8FF46)
private val LimeDeep = Color(0xFF4D7A10)
private val Ink = Color(0xFF0B0D11)
private val Panel = Color(0xFF171B22)
private val PanelHigh = Color(0xFF1F242D)
private val TextHigh = Color(0xFFF3F5F8)
private val TextMuted = Color(0xFF9FA6B1)
private val Danger = Color(0xFFFF8989)

private val Dark = darkColorScheme(
    primary = Lime, onPrimary = Ink, primaryContainer = LimeDeep, onPrimaryContainer = TextHigh,
    // Without these, selected chips and tonal buttons fall back to Material's default lavender.
    secondary = Lime, onSecondary = Ink, secondaryContainer = LimeDeep, onSecondaryContainer = TextHigh,
    tertiary = Lime, onTertiary = Ink, tertiaryContainer = LimeDeep, onTertiaryContainer = TextHigh,
    background = Ink, onBackground = TextHigh, surface = Ink, onSurface = TextHigh,
    surfaceContainer = Panel, surfaceContainerHigh = PanelHigh, surfaceVariant = PanelHigh,
    onSurfaceVariant = TextMuted, outline = Color(0xFF667080), error = Danger, onError = Ink,
)

private val Light = lightColorScheme(
    primary = LimeDeep, onPrimary = Color.White, primaryContainer = Color(0xFFDDF8B9), onPrimaryContainer = Color(0xFF1C2A06),
    secondary = LimeDeep, onSecondary = Color.White, secondaryContainer = Color(0xFFDDF8B9), onSecondaryContainer = Color(0xFF1C2A06),
    tertiary = LimeDeep, onTertiary = Color.White, tertiaryContainer = Color(0xFFDDF8B9), onTertiaryContainer = Color(0xFF1C2A06),
    background = Color(0xFFF7F8FA), onBackground = Ink, surface = Color(0xFFF7F8FA), onSurface = Ink,
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFEFF1F4), onSurfaceVariant = Color(0xFF545B66),
    error = Color(0xFFB3261E),
)

private fun ColorScheme.withAccent(accent: Color, onAccent: Color, container: Color, onContainer: Color) = copy(
    primary = accent, onPrimary = onAccent, primaryContainer = container, onPrimaryContainer = onContainer,
    secondary = accent, onSecondary = onAccent, secondaryContainer = container, onSecondaryContainer = onContainer,
    tertiary = accent, onTertiary = onAccent, tertiaryContainer = container, onTertiaryContainer = onContainer,
)

private data class AccentRoles(val primary: Color, val onPrimary: Color, val container: Color, val onContainer: Color)
private data class AccentPalette(val dark: AccentRoles, val light: AccentRoles)

private val AccentPalettes = mapOf(
    Accent.GREEN to AccentPalette(
        dark = AccentRoles(Lime, Ink, LimeDeep, TextHigh),
        light = AccentRoles(LimeDeep, Color.White, Color(0xFFDDF8B9), Color(0xFF1C2A06)),
    ),
    Accent.RED to AccentPalette(
        dark = AccentRoles(Color(0xFFFF5F3D), Ink, Color(0xFF5C1F12), TextHigh),
        light = AccentRoles(Color(0xFFC02C04), Color.White, Color(0xFFFFDDD4), Color(0xFF3A0B00)),
    ),
    Accent.BLUE to AccentPalette(
        dark = AccentRoles(Color(0xFF65D6FF), Ink, Color(0xFF16465E), Color(0xFFEAF7FF)),
        light = AccentRoles(Color(0xFF005A7D), Color.White, Color(0xFFCBEAFF), Color(0xFF001E2B)),
    ),
    Accent.VIOLET to AccentPalette(
        dark = AccentRoles(Color(0xFFD0BCFF), Ink, Color(0xFF4B3E70), TextHigh),
        light = AccentRoles(Color(0xFF6750A4), Color.White, Color(0xFFEADDFF), Color(0xFF21005D)),
    ),
)

private fun accentScheme(base: ColorScheme, accent: Accent, dark: Boolean): ColorScheme {
    val roles = AccentPalettes.getValue(accent).let { if (dark) it.dark else it.light }
    return base.withAccent(roles.primary, roles.onPrimary, roles.container, roles.onContainer)
}

private val Contrast = lightColorScheme(
    primary = Color(0xFF7A1500), onPrimary = Color.White, primaryContainer = Color(0xFFFFDAD2), onPrimaryContainer = Color(0xFF0B0D11),
    secondary = Color(0xFF7A1500), onSecondary = Color.White, secondaryContainer = Color(0xFFFFDAD2), onSecondaryContainer = Color(0xFF0B0D11),
    tertiary = Color(0xFF7A1500), onTertiary = Color.White, tertiaryContainer = Color(0xFFFFDAD2), onTertiaryContainer = Color(0xFF0B0D11),
    background = Color.White, onBackground = Color(0xFF0B0D11), surface = Color.White, onSurface = Color(0xFF0B0D11),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFEEF1F5), onSurfaceVariant = Color(0xFF3D4654),
    outline = Color(0xFF767F8C), error = Color(0xFF880000),
)

/** The user's display choice (More -> Display) applied over the device's dark/light setting. */
@Composable
fun HackLimitsTheme(prefs: DisplayPrefs = DisplayPrefs(), content: @Composable () -> Unit) {
    val accent = prefs.effectiveAccent() ?: Accent.GREEN
    val scheme = when (prefs.resolvedTheme(isSystemInDarkTheme())) {
        ResolvedTheme.CONTRAST -> Contrast
        ResolvedTheme.DARK -> accentScheme(Dark, accent, dark = true)
        ResolvedTheme.LIGHT -> accentScheme(Light, accent, dark = false)
    }
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalReducedMotion provides prefs.reducedMotion, content = content)
    }
}
