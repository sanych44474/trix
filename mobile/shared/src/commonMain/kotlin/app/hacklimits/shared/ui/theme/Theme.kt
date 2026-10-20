package app.hacklimits.shared.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Brand tokens shared with the Mini App: near-black ground, electric-lime accent.
private val Lime = Color(0xFFA8FF46)
private val LimeDeep = Color(0xFF4F7D12)
private val Ink = Color(0xFF0B0D11)
private val Panel = Color(0xFF171B22)
private val PanelHigh = Color(0xFF1F242D)
private val TextHigh = Color(0xFFF3F5F8)
private val TextMuted = Color(0xFF9FA6B1)
private val Danger = Color(0xFFFF8989)

private val Dark = darkColorScheme(
    primary = Lime, onPrimary = Ink, primaryContainer = LimeDeep, onPrimaryContainer = TextHigh,
    background = Ink, onBackground = TextHigh, surface = Ink, onSurface = TextHigh,
    surfaceContainer = Panel, surfaceContainerHigh = PanelHigh, surfaceVariant = PanelHigh,
    onSurfaceVariant = TextMuted, outline = Color(0xFF3A414D), error = Danger, onError = Ink,
)

private val Light = lightColorScheme(
    primary = LimeDeep, onPrimary = Color.White, primaryContainer = Color(0xFFDDF8B9), onPrimaryContainer = Color(0xFF1C2A06),
    background = Color(0xFFF7F8FA), onBackground = Ink, surface = Color(0xFFF7F8FA), onSurface = Ink,
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFEFF1F4), onSurfaceVariant = Color(0xFF545B66),
    error = Color(0xFFB3261E),
)

@Composable
fun HackLimitsTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
