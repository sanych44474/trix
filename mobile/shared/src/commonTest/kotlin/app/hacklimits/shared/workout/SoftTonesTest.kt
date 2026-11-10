package app.hacklimits.shared.workout

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import app.hacklimits.shared.workout.logic.softTones
import kotlin.test.Test
import kotlin.test.assertTrue

class SoftTonesTest {
    @Test
    fun anInsetFieldIsDarkerThanTheCardInBothThemes() {
        for (surface in listOf(Color(0xFF141820), Color.White)) {
            val tones = softTones(surface)
            assertTrue(tones.insetFill.luminance() < surface.luminance(), "inset fill on $surface")
        }
    }

    @Test
    fun theHighlightIsLighterThanTheShade() {
        for (surface in listOf(Color(0xFF141820), Color.White)) {
            val tones = softTones(surface)
            assertTrue(tones.highlight.luminance() > tones.shade.luminance())
        }
    }

    @Test
    fun aDarkCardGetsAFaintHighlightNotWhite() {
        assertTrue(softTones(Color(0xFF141820)).highlight.alpha < 0.2f, "a full-white edge glows on a dark card")
    }
}
