package app.hacklimits.shared.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The few icons the app draws itself (Material's icon artifacts are no longer published for Compose
 * Multiplatform). 24dp grid, filled; the bar tints them. */
object HackLimitsIcons {
    val Today: ImageVector by lazy {
        icon("Today") {
            // Calendar page with a highlighted day.
            moveTo(7f, 2f); lineTo(9f, 2f); lineTo(9f, 4f); lineTo(15f, 4f); lineTo(15f, 2f); lineTo(17f, 2f); lineTo(17f, 4f)
            lineTo(20f, 4f); lineTo(20f, 21f); lineTo(4f, 21f); lineTo(4f, 4f); lineTo(7f, 4f); close()
            moveTo(6f, 9f); lineTo(6f, 19f); lineTo(18f, 19f); lineTo(18f, 9f); close()
            moveTo(8f, 11f); lineTo(12f, 11f); lineTo(12f, 15f); lineTo(8f, 15f); close()
        }
    }

    val Progress: ImageVector by lazy {
        icon("Progress") {
            // Rising bars.
            moveTo(4f, 20f); lineTo(4f, 13f); lineTo(8f, 13f); lineTo(8f, 20f); close()
            moveTo(10f, 20f); lineTo(10f, 8f); lineTo(14f, 8f); lineTo(14f, 20f); close()
            moveTo(16f, 20f); lineTo(16f, 4f); lineTo(20f, 4f); lineTo(20f, 20f); close()
        }
    }

    val Food: ImageVector by lazy {
        icon("Food") {
            // Plate with fork and knife.
            moveTo(5f, 2f); lineTo(6f, 2f); lineTo(6f, 8f); lineTo(7f, 8f); lineTo(7f, 2f); lineTo(8f, 2f); lineTo(8f, 8f); lineTo(9f, 8f); lineTo(9f, 2f); lineTo(10f, 2f)
            lineTo(10f, 9f); lineTo(8f, 11f); lineTo(8f, 22f); lineTo(6f, 22f); lineTo(6f, 11f); lineTo(5f, 9f); close()
            moveTo(14f, 2f); lineTo(19f, 2f); lineTo(19f, 22f); lineTo(17f, 22f); lineTo(17f, 14f); lineTo(14f, 14f); close()
        }
    }

    val More: ImageVector by lazy {
        icon("More") {
            // Three horizontal lines.
            moveTo(4f, 6f); lineTo(20f, 6f); lineTo(20f, 8f); lineTo(4f, 8f); close()
            moveTo(4f, 11f); lineTo(20f, 11f); lineTo(20f, 13f); lineTo(4f, 13f); close()
            moveTo(4f, 16f); lineTo(20f, 16f); lineTo(20f, 18f); lineTo(4f, 18f); close()
        }
    }

    private fun icon(name: String, block: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .path(fill = SolidColor(Color.Black), pathBuilder = block)
            .build()
}
