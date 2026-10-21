package app.hacklimits.shared.progress

import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.jsRound
import kotlinx.datetime.LocalDate
import kotlin.math.max
import kotlin.math.min

// The numbers the Progress screen reads off the dashboard: this week's workouts, weight change,
// sets, the calorie target of a day, and the macro history. Port of the derived values in
// ProgressView.tsx and logic/todayPlan.ts.

data class WeekSummary(
    val weekDone: Int,
    val weekPlanned: Int,
    val weekSets: Int,
    val weightDelta: Double?, // latest weigh-in minus one from the week before, when both are recent enough
)

/** Monday of the week containing `today` (ISO weekdays, Monday first). */
fun mondayOf(today: String): String = isoPlusDays(today, -LocalDate.parse(today).dayOfWeek.ordinal)

fun weekSummary(d: ProgressDashboard): WeekSummary {
    val today = d.today
    val monday = mondayOf(today)
    val byDate = d.calendar.days.associate { it.date to it.status }
    val todayDone = d.calendar.logs.any { it.date == today && it.done }
    val weekDates = (0 until 7).map { isoPlusDays(monday, it) }
    val weekDone = weekDates.count { date -> byDate[date] == "done" || (date == today && todayDone) }
    val planned = d.calendar.split.map { it.weekday }.filter { it in 1..7 }.toSet().size
    val sets = d.calendar.logs.filter { it.done && it.date >= monday }.sumOf { log -> log.ex.sumOf { it.s } }

    val sorted = d.weight.points.sortedBy { it.date }
    val latest = sorted.lastOrNull()
    val weekAgo = isoPlusDays(today, -7)
    val twoWeeksAgo = isoPlusDays(today, -14)
    val before = sorted.lastOrNull { it.date <= weekAgo }
    val delta = if (latest != null && before != null && before.date != latest.date && latest.date > weekAgo && before.date > twoWeeksAgo) {
        jsRound((latest.kg - before.kg) * 10) / 10
    } else {
        null
    }
    return WeekSummary(weekDone, max(planned, weekDone), sets, delta)
}

/** The day's calorie target: the rest-day target on a day that wasn't a training day, when the plan has one. */
fun targetsForDay(training: Boolean, macros: ProgressDashboard.Macros): Pair<ProgressDashboard.Macros.Targets?, Boolean> =
    if (!training && macros.restTargets != null) macros.restTargets to true else macros.targets to false

/** The last seven days with their kcal as a share of the day's calorie target (0..100), oldest first. */
fun macroHistory(macros: ProgressDashboard.Macros): List<Pair<ProgressDashboard.Macros.Day, Int>> =
    macros.days.takeLast(7).map { day ->
        val target = targetsForDay(day.training, macros).first?.calories
        day to (if (target != null) min(100.0, day.kcal / max(1.0, target) * 100).toInt() else 0)
    }
