package app.hacklimits.shared.progress.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.progress.muscle.jsRound
import kotlin.math.abs
import kotlin.math.roundToLong

/** Numbers as the Mini App prints them: at most one decimal, comma in Ukrainian. */
fun formatNumber(value: Double, uk: Boolean): String {
    val rounded = jsRound(value * 10) / 10
    val text = if (rounded % 1.0 == 0.0) rounded.roundToLong().toString() else {
        val tenths = jsRound(abs(rounded) * 10).toLong()
        val sign = if (rounded < 0) "-" else ""
        "$sign${tenths / 10}.${tenths % 10}"
    }
    return if (uk) text.replace('.', ',') else text
}

/** A section card (the Mini App's `card`). */
@Composable
fun ProgressCard(title: String? = null, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

/**
 * A labelled dropdown (the Mini App's `<select>`): `options` are (key, label) pairs. A key starting
 * with "#" is a non-selectable group header (an `<optgroup>` label).
 */
@Composable
fun SelectField(label: String, selectedLabel: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) { Text(selectedLabel, maxLines = 1) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (key, text) ->
                    if (key.startsWith("#")) {
                        DropdownMenuItem(
                            text = { Text(text, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                            enabled = false,
                            onClick = {},
                        )
                    } else {
                        DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(key) })
                    }
                }
            }
        }
    }
}

/** One data point of a line chart: the label is shown to screen readers. */
data class ChartPoint(val label: String, val value: Double)

/** Small line chart, the Mini App's LineChart (min..max of the data, a dot per point). */
@Composable
fun LineChart(points: List<ChartPoint>, color: Color, modifier: Modifier = Modifier) {
    if (points.size < 2) return
    val values = points.map { it.value }
    val min = values.min()
    val max = values.max()
    val span = if (max - min == 0.0) 1.0 else max - min
    Canvas(modifier.fillMaxWidth().height(92.dp)) {
        val pad = 8.dp.toPx()
        val stepX = (size.width - pad * 2) / (points.size - 1)
        fun y(v: Double) = (size.height - pad - ((v - min) / span) * (size.height - pad * 2)).toFloat()
        var previous: Offset? = null
        points.forEachIndexed { i, p ->
            val at = Offset(pad + i * stepX, y(p.value))
            previous?.let { drawLine(color, it, at, strokeWidth = 2.5.dp.toPx()) }
            drawCircle(color, radius = 3.dp.toPx(), center = at)
            previous = at
        }
    }
}

/** The macro donut: protein, fat and carb shares of calories, with the kcal in the middle. */
@Composable
fun MacroDonut(proteinPct: Float, fatPct: Float, carbPct: Float, protein: Color, fat: Color, carb: Color, centre: @Composable () -> Unit) {
    Box(Modifier.size(132.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(132.dp)) {
            val stroke = 22.dp.toPx()
            val inset = stroke / 2
            val arcSize = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke)
            var start = -90f
            for ((pct, color) in listOf(proteinPct to protein, fatPct to fat, carbPct to carb)) {
                val sweep = pct * 3.6f
                if (sweep > 0f) drawArc(color, start, sweep, useCenter = false, topLeft = Offset(inset, inset), size = arcSize, style = Stroke(stroke))
                start += sweep
            }
        }
        centre()
    }
}

/** A legend swatch. */
@Composable
fun Swatch(color: Color) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(color))
}

@Composable
fun MutedText(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
}
