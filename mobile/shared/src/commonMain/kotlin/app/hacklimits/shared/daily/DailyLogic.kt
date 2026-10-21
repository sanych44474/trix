package app.hacklimits.shared.daily

import kotlin.math.abs
import kotlin.math.roundToInt

/** Where a survey item is logged: food on the Fuel tab, water and steps on Today, the check-in on Progress. */
enum class ChecklistTarget { Fuel, Today, Progress }

fun checklistTargetOf(key: String): ChecklistTarget = when (key) {
    "food" -> ChecklistTarget.Fuel
    "checkin" -> ChecklistTarget.Progress
    else -> ChecklistTarget.Today
}

/** One decimal place without a locale ("3.4", "0.0"), the same figure the bot's /well prints. */
fun oneDecimal(value: Double): String {
    val tenths = (abs(value) * 10).roundToInt()
    val sign = if (value < 0 && tenths != 0) "-" else ""
    return "$sign${tenths / 10}.${tenths % 10}"
}

/** "▲" / "▼" for a change of at least a tenth of a point; "—" when the metric is flat. */
fun trendArrow(change: Double): String = when {
    abs(change) < 0.05 -> "—"
    change > 0 -> "▲"
    else -> "▼"
}

/** Whether a change is in the good direction: energy and sleep up, stress down. */
fun isGoodTrend(metric: String, change: Double): Boolean = if (metric == "stress") change < 0 else change > 0

/** "07:00" for a reminder hour. */
fun hourLabel(hour: Int): String = "${hour.toString().padStart(2, '0')}:00"
