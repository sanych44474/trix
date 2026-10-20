package app.hacklimits.shared.progress

import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.progress.muscle.daysUntilIso
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.jsRound
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// Geometry for the weight chart: points on a real kg scale, a 7-day average (the trend that counts),
// and the goal line when it sits inside the drawn range. Port of logic/weightChart.ts.

data class WeightChartPoint(val date: String, val kg: Double, val x: Double, val y: Double)

/** x and y are in 0..100 (y from the bottom). */
data class WeightChartModel(
    val axisMin: Double,
    val axisMax: Double,
    val points: List<WeightChartPoint>,
    val trend: List<WeightChartPoint>, // 7-day rolling average, one per weigh-in (kg holds the average)
    val goalY: Double?,
    val deltaKg: Double, // 7-day average, last minus first
    val spanDays: Int,
)

/** For each weigh-in (sorted by date), the mean of the weigh-ins in the 7 days ending on it. */
fun rollingAverage(sorted: List<ProgressDashboard.Weight.Point>, days: Int = 7): List<Double> = sorted.map { p ->
    val start = isoPlusDays(p.date, -(days - 1))
    val win = sorted.filter { it.date >= start && it.date <= p.date }
    jsRound(win.sumOf { it.kg } / win.size * 100) / 100
}

fun weightChartModel(points: List<ProgressDashboard.Weight.Point>, goal: Double?): WeightChartModel? {
    val sorted = points.filter { it.kg > 0 }.sortedBy { it.date }
    if (sorted.size < 2) return null
    val kgs = sorted.map { it.kg }
    var lo = kgs.min()
    var hi = kgs.max()
    // A goal within 5 kg of the data is pulled into view so its line can be drawn.
    if (goal != null && goal > 0 && goal >= lo - 5 && goal <= hi + 5) {
        lo = min(lo, goal)
        hi = max(hi, goal)
    }
    val pad = max(0.5, (hi - lo) * 0.15)
    lo -= pad
    hi += pad
    if (hi - lo < 2) {
        val mid = (hi + lo) / 2
        lo = mid - 1
        hi = mid + 1
    }
    val axisMin = floor(lo * 2) / 2
    val axisMax = ceil(hi * 2) / 2
    val first = sorted.first().date
    val last = sorted.last().date
    val spanDays = first.daysUntilIso(last)
    val span = max(1, spanDays).toDouble()
    fun x(date: String) = first.daysUntilIso(date) / span * 100
    fun y(kg: Double) = (kg - axisMin) / (axisMax - axisMin) * 100
    val avg = rollingAverage(sorted)
    return WeightChartModel(
        axisMin = axisMin,
        axisMax = axisMax,
        points = sorted.map { WeightChartPoint(it.date, it.kg, x(it.date), y(it.kg)) },
        trend = sorted.mapIndexed { i, p -> WeightChartPoint(p.date, avg[i], x(p.date), y(avg[i])) },
        goalY = if (goal != null && goal >= axisMin && goal <= axisMax) y(goal) else null,
        deltaKg = jsRound((avg.last() - avg.first()) * 10) / 10,
        spanDays = spanDays,
    )
}
