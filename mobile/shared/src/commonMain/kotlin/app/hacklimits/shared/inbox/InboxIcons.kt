package app.hacklimits.shared.inbox

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Line icons for the feed rows, kept with the inbox rather than in the shared theme. 24dp grid. */
internal fun inboxIcon(kind: String): ImageVector = when (kind) {
    "plan_assigned", "plan_changed", "progression" -> InboxIcons.Plan
    "message" -> InboxIcons.Chat
    "badge" -> InboxIcons.Badge
    "feedback_done" -> InboxIcons.Check
    else -> InboxIcons.People
}

private object InboxIcons {
    val Plan: ImageVector by lazy {
        line("InboxPlan") {
            moveTo(5f, 3f); lineTo(19f, 3f); lineTo(19f, 21f); lineTo(5f, 21f); close()
            moveTo(8f, 8f); lineTo(16f, 8f)
            moveTo(8f, 12f); lineTo(16f, 12f)
            moveTo(8f, 16f); lineTo(13f, 16f)
        }
    }

    val Chat: ImageVector by lazy {
        line("InboxChat") {
            moveTo(4f, 4f); lineTo(20f, 4f); lineTo(20f, 16f); lineTo(10f, 16f); lineTo(6f, 20f); lineTo(6f, 16f); lineTo(4f, 16f); close()
        }
    }

    val Badge: ImageVector by lazy {
        line("InboxBadge") {
            moveTo(9f, 3f); lineTo(9f, 12f)
            moveTo(15f, 3f); lineTo(15f, 12f)
            moveTo(7f, 12f); lineTo(17f, 12f); lineTo(17f, 20f); lineTo(7f, 20f); close()
        }
    }

    val Check: ImageVector by lazy {
        line("InboxCheck") {
            moveTo(4f, 12f); lineTo(9f, 17f); lineTo(20f, 6f)
        }
    }

    val People: ImageVector by lazy {
        line("InboxPeople") {
            moveTo(7f, 4f); lineTo(11f, 4f); lineTo(11f, 8f); lineTo(7f, 8f); close()
            moveTo(3f, 20f); lineTo(3f, 14f); lineTo(15f, 14f); lineTo(15f, 20f); close()
            moveTo(15f, 6f); lineTo(19f, 6f)
            moveTo(17f, 4f); lineTo(17f, 8f)
        }
    }

    private fun line(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .path(
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = block,
            )
            .build()
}
