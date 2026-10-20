package app.hacklimits.shared.progress.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.progress.WeightChartModel
import app.hacklimits.shared.progress.muscle.jsRound
import app.hacklimits.shared.progress.weightChartModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_goal_kg
import app.hacklimits.shared.resources.pr_wc_avg
import app.hacklimits.shared.resources.pr_wc_change
import app.hacklimits.shared.resources.pr_wc_change_flat
import app.hacklimits.shared.resources.pr_wc_legend_goal
import app.hacklimits.shared.resources.pr_wc_legend_raw
import app.hacklimits.shared.resources.pr_wc_legend_trend
import app.hacklimits.shared.resources.pr_wc_per_week
import app.hacklimits.shared.resources.pr_unit_kg
import org.jetbrains.compose.resources.stringResource
import kotlin.math.abs
import kotlin.math.hypot

private val MONTHS_UK = listOf("січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "листоп", "груд")
private val MONTHS_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** "3 Oct" / "3 жовт": the day and short month, as the Mini App's dayFmt prints it. */
fun shortDate(iso: String, uk: Boolean): String {
    val month = iso.substring(5, 7).toIntOrNull()?.let { it - 1 } ?: return iso
    val day = iso.substring(8, 10).trimStart('0')
    val names = if (uk) MONTHS_UK else MONTHS_EN
    return "$day ${names.getOrElse(month) { "" }}"
}

/** The weight trend: the 7-day average as the line that counts, the weigh-ins as dots, the goal as a dashed line. */
@Composable
fun WeightChartView(
    points: List<ProgressDashboard.Weight.Point>,
    goal: Double?,
    slopePerWeek: Double?,
    uk: Boolean,
) {
    val model = weightChartModel(points, goal) ?: return
    var selected by remember(points) { mutableStateOf<Int?>(null) }
    val index = selected ?: (model.points.size - 1)
    val p = model.points[index]
    val kg = stringResource(Res.string.pr_unit_kg)
    val signed: (Double) -> String = { n -> (if (n > 0) "+" else if (n < 0) "−" else "") + formatNumber(abs(n), uk) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (abs(model.deltaKg) < 0.05) stringResource(Res.string.pr_wc_change_flat, model.spanDays)
                else stringResource(Res.string.pr_wc_change, signed(model.deltaKg), model.spanDays),
                style = MaterialTheme.typography.bodyMedium,
            )
            slopePerWeek?.let { Text(stringResource(Res.string.pr_wc_per_week, signed(jsRoundTenth(it))), style = MaterialTheme.typography.bodySmall) }
            goal?.takeIf { it > 0 }?.let { Text(stringResource(Res.string.pr_goal_kg, formatNumber(it, uk)), style = MaterialTheme.typography.bodySmall) }
        }
        WeightPlot(model, selected = index, onSelect = { selected = it }, uk = uk)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(shortDate(model.points.first().date, uk), style = MaterialTheme.typography.labelSmall)
            Text(shortDate(model.points.last().date, uk), style = MaterialTheme.typography.labelSmall)
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${formatNumber(p.kg, uk)} $kg", style = MaterialTheme.typography.titleSmall)
            Text(shortDate(p.date, uk), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(Res.string.pr_wc_avg, formatNumber(model.trend[index].kg, uk)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(Res.string.pr_wc_legend_trend), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(stringResource(Res.string.pr_wc_legend_raw), style = MaterialTheme.typography.labelSmall)
            if (model.goalY != null) Text(stringResource(Res.string.pr_wc_legend_goal), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun jsRoundTenth(v: Double): Double = jsRound(v * 10) / 10

@Composable
private fun WeightPlot(model: WeightChartModel, selected: Int, onSelect: (Int) -> Unit, uk: Boolean) {
    val line = MaterialTheme.colorScheme.primary
    val raw = MaterialTheme.colorScheme.onSurfaceVariant
    val goalColor = MaterialTheme.colorScheme.tertiary
    val dash = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))
    Box(Modifier.fillMaxWidth().height(160.dp)) {
        Canvas(
            Modifier.fillMaxWidth().height(160.dp).pointerInput(model) {
                detectTapGestures { tap ->
                    val w = size.width.toFloat()
                    val h = size.height.toFloat()
                    val nearest = model.points.indices.minByOrNull { i ->
                        val q = model.points[i]
                        hypot(q.x.toFloat() / 100f * w - tap.x, (100f - q.y.toFloat()) / 100f * h - tap.y)
                    }
                    if (nearest != null) onSelect(nearest)
                }
            },
        ) {
            fun px(x: Double, y: Double) = Offset((x / 100.0 * size.width).toFloat(), ((100.0 - y) / 100.0 * size.height).toFloat())
            model.goalY?.let { g ->
                val y = px(0.0, g).y
                drawLine(goalColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.5.dp.toPx(), pathEffect = dash)
            }
            for (i in 1 until model.points.size) {
                drawLine(raw.copy(alpha = 0.5f), px(model.points[i - 1].x, model.points[i - 1].y), px(model.points[i].x, model.points[i].y), strokeWidth = 1.dp.toPx())
            }
            for (i in 1 until model.trend.size) {
                drawLine(line, px(model.trend[i - 1].x, model.trend[i - 1].y), px(model.trend[i].x, model.trend[i].y), strokeWidth = 2.5.dp.toPx())
            }
            for ((i, q) in model.points.withIndex()) {
                drawCircle(if (i == selected) line else raw, radius = if (i == selected) 5.dp.toPx() else 3.dp.toPx(), center = px(q.x, q.y))
            }
        }
        Text(formatNumber(model.axisMax, uk), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(2.dp))
        Text(formatNumber(model.axisMin, uk), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(2.dp).align(androidx.compose.ui.Alignment.BottomStart))
    }
}
