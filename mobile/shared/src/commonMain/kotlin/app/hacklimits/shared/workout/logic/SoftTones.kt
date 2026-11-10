package app.hacklimits.shared.workout.logic

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance

/**
 * The colors of the logger's soft (neumorphic) look for a given surface: a shade and a highlight
 * for the edges, and the fill of an inset field (a step darker than the card it is pressed into).
 * Same tokens as the Mini App (--soft-lo / --soft-hi in styles.css), so the two clients match.
 */
data class SoftTones(val shade: Color, val highlight: Color, val insetFill: Color)

fun softTones(surface: Color): SoftTones =
    if (surface.luminance() < 0.5f) {
        SoftTones(shade = Color.Black.copy(alpha = 0.55f), highlight = Color.White.copy(alpha = 0.08f), insetFill = lerp(surface, Color.Black, 0.25f))
    } else {
        SoftTones(shade = Color(0xFF18202B).copy(alpha = 0.16f), highlight = Color.White, insetFill = lerp(surface, Color(0xFF18202B), 0.06f))
    }
