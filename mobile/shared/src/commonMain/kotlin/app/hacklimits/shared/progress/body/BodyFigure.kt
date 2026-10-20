package app.hacklimits.shared.progress.body

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput

// One side of the anatomical figure (front or back), drawn from the same SVG paths the Mini App's
// react-muscle-highlighter uses (BodyMapFigures.kt). Each muscle's paths are filled with its colour;
// a tap reports the muscle whose shape is under the finger.

private const val FIGURE_WIDTH = 724f
private const val FIGURE_HEIGHT = 1448f

private class DrawnPart(val slug: String, val paths: List<Path>)

@Composable
fun BodyFigure(
    male: Boolean,
    front: Boolean,
    colors: Map<String, Color>, // muscle slug to fill; any slug not listed gets `base`
    base: Color,
    border: Color,
    onTap: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val parts = remember(male, front) {
        val source = when {
            male && front -> BodyMapFigures.maleFront
            male -> BodyMapFigures.maleBack
            front -> BodyMapFigures.femaleFront
            else -> BodyMapFigures.femaleBack
        }
        source.map { part -> DrawnPart(part.slug, part.paths.map { PathParser().parsePathString(it).toPath() }) }
    }
    val outline = remember(male, front) {
        val d = when {
            male && front -> BodyMapFigures.maleOutlineFront
            male -> BodyMapFigures.maleOutlineBack
            front -> BodyMapFigures.femaleOutlineFront
            else -> BodyMapFigures.femaleOutlineBack
        }
        PathParser().parsePathString(d).toPath()
    }
    val originX = if (front) 0f else FIGURE_WIDTH
    val paintOf = { slug: String -> colors[slug] ?: if (slug == "hair") border else base }

    Canvas(
        modifier
            .aspectRatio(FIGURE_WIDTH / FIGURE_HEIGHT)
            .pointerInput(parts) {
                detectTapGestures { tap ->
                    val scale = size.width / FIGURE_WIDTH
                    val point = Offset(tap.x / scale + originX, tap.y / scale)
                    // Later parts are drawn on top, so they win an overlap.
                    val hit = parts.lastOrNull { part -> part.slug in TAPPABLE_SLUGS && part.paths.any { it.getBounds().contains(point) } }
                    if (hit != null) onTap(hit.slug)
                }
            },
    ) {
        val scale = size.width / FIGURE_WIDTH
        withTransform({
            scale(scale, scale, Offset.Zero)
            translate(left = -originX, top = 0f)
        }) {
            for (part in parts) {
                val fill = paintOf(part.slug)
                for (path in part.paths) drawPath(path, fill)
            }
            drawPath(outline, border, style = Stroke(width = 2f / scale))
        }
    }
}
