package app.hacklimits.shared.progress.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.progress.muscle.LoggedDay
import app.hacklimits.shared.progress.muscle.MUSCLE_LANDMARKS
import app.hacklimits.shared.progress.muscle.MuscleLookup
import app.hacklimits.shared.progress.muscle.TRACKED_MUSCLES
import app.hacklimits.shared.progress.muscle.jsRound
import app.hacklimits.shared.progress.muscle.weeklyMuscleSeries
import app.hacklimits.shared.progress.muscle.musclesForExercise
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_trend_band
import app.hacklimits.shared.resources.pr_trend_bar_detail
import app.hacklimits.shared.resources.pr_trend_down
import app.hacklimits.shared.resources.pr_trend_pick_label
import app.hacklimits.shared.resources.pr_trend_summary
import app.hacklimits.shared.resources.pr_trend_up
import org.jetbrains.compose.resources.stringResource
import kotlin.math.floor

/** Per-muscle trend: fractional sets for the last 12 weeks, one muscle at a time, against its MEV-MAV band. */
@Composable
fun MuscleTrendView(logs: List<LoggedDay>, today: String, uk: Boolean, lookup: MuscleLookup = ::musclesForExercise) {
    val series = remember(logs, today) { weeklyMuscleSeries(logs, today, 12, lookup) }
    val lagging = remember(series) {
        var best: Pair<String, Double>? = null
        for (slug in TRACKED_MUSCLES) {
            val mev = MUSCLE_LANDMARKS[slug]?.mev ?: 0
            if (mev == 0) continue
            val ratio = average(series.series.getValue(slug).takeLast(4)) / mev
            if (ratio < 1 && (best == null || ratio < best.second)) best = slug to ratio
        }
        best?.first ?: "chest"
    }
    var picked by remember(logs) { mutableStateOf<String?>(null) }
    var bar by remember(logs) { mutableStateOf<Int?>(null) }
    val slug = picked ?: lagging
    val values = series.series.getValue(slug)
    val landmarks = MUSCLE_LANDMARKS[slug] ?: app.hacklimits.shared.progress.muscle.Landmarks(0, 16)
    val mev = landmarks.mev
    val mav = landmarks.mav
    val options = TRACKED_MUSCLES.map { s -> s to "${muscleLabel(s)} · ${formatNumber(halfRound(average(series.series.getValue(s).takeLast(4))), uk)}" }
    val selectedText = options.first { it.first == slug }.second

    val recent = average(values.takeLast(4))
    val before = average(values.dropLast(4).takeLast(4))
    val change = if (before > 0) jsRound((recent - before) / before * 100).toInt() else null
    val selectedIndex = bar
    val weekEnd = series.weekEnds
    val weekLabel: (String) -> String = { iso -> "${iso.substring(8, 10)}.${iso.substring(5, 7)}" }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SelectField(stringResource(Res.string.pr_trend_pick_label), selectedText, options) { key ->
            picked = key
            bar = null
        }
        val top = (maxOf(mav.toDouble(), values.maxOrNull() ?: 0.0) * 1.1).takeIf { it > 0 } ?: 1.0
        val band = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
        val bars = MaterialTheme.colorScheme.primary
        val barsIdle = MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)
        val axis = MaterialTheme.colorScheme.outlineVariant
        Canvas(
            Modifier.fillMaxWidth().height(150.dp).pointerInput(values) {
                detectTapGestures { tap ->
                    val plotLeft = 4.dp.toPx()
                    val plotWidth = size.width - plotLeft - 4.dp.toPx()
                    val slot = plotWidth / values.size
                    val index = floor((tap.x - plotLeft) / slot).toInt()
                    if (index in values.indices) bar = if (bar == index) null else index
                }
            },
        ) {
            val padLeft = 4.dp.toPx()
            val padRight = 4.dp.toPx()
            val padTop = 8.dp.toPx()
            val padBottom = 20.dp.toPx()
            val plotH = size.height - padTop - padBottom
            fun y(v: Double) = (padTop + plotH - (v / top) * plotH).toFloat()
            val slot = (size.width - padLeft - padRight) / values.size
            val barW = maxOf(4f, slot - 4f)
            if (mev > 0) {
                drawRoundRect(band, Offset(padLeft, y(mav.toDouble())), Size(size.width - padLeft - padRight, y(mev.toDouble()) - y(mav.toDouble())), CornerRadius(4.dp.toPx()))
            }
            drawLine(axis, Offset(padLeft, y(0.0)), Offset(size.width - padRight, y(0.0)), strokeWidth = 1.dp.toPx())
            values.forEachIndexed { i, v ->
                val x = padLeft + i * slot + (slot - barW) / 2
                val h = maxOf(if (v > 0) 3f else 0f, y(0.0) - y(v))
                if (h > 0f) {
                    drawRoundRect(
                        if (bar == i) bars else barsIdle,
                        Offset(x, y(0.0) - h),
                        Size(barW, h),
                        CornerRadius(4.dp.toPx()),
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(weekLabel(weekEnd.first()), style = MaterialTheme.typography.labelSmall)
            Text(weekLabel(weekEnd.last()), style = MaterialTheme.typography.labelSmall)
        }
        val detail = if (selectedIndex != null) {
            stringResource(Res.string.pr_trend_bar_detail, weekLabel(weekEnd[selectedIndex]), muscleLabel(slug), formatNumber(halfRound(values[selectedIndex]), uk))
        } else {
            buildList {
                add(stringResource(Res.string.pr_trend_summary, formatNumber(halfRound(recent), uk)))
                if (change != null) add(stringResource(if (change >= 0) Res.string.pr_trend_up else Res.string.pr_trend_down, kotlin.math.abs(change)))
                if (mev > 0) add(stringResource(Res.string.pr_trend_band, mev, mav))
            }.joinToString(" ")
        }
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun average(xs: List<Double>): Double = if (xs.isEmpty()) 0.0 else xs.sum() / xs.size

/** Sets rounded to the nearest half, as the Mini App's trend shows them. */
private fun halfRound(n: Double): Double = jsRound(n * 2) / 2
