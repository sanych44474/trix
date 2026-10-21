package app.hacklimits.shared.today

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.Dashboard
import kotlinx.datetime.LocalDate
import kotlinx.serialization.decodeFromString
import kotlin.math.abs
import kotlin.math.roundToLong

// The last full week (Mon-Sun) in one card on Today, built from what the dashboard already carries:
// workouts done vs planned, the change in average weight against the week before, days with food
// logged, new strength records (e1RM above every earlier point), and one focus for the week ahead.
// Port of the Mini App's logic/weekSummary.ts and logic/badgesSeen.ts.

enum class WeekFocus { Workouts, Weigh, Food, Keep }

data class WeekSummary(
    val start: String,
    val end: String,
    val workouts: Int,
    val planned: Int,
    /** kg: this week's average weight minus the week before's; null without two weeks of weigh-ins. */
    val weightDelta: Double?,
    val foodDays: Int,
    val records: List<String>,
    val focus: WeekFocus,
)

fun lastWeekSummary(d: Dashboard): WeekSummary {
    val today = LocalDate.parse(d.today)
    val dow = today.dayOfWeek.ordinal // Monday = 0
    val startDay = today.toEpochDays() - (dow + 7)
    val startS = LocalDate.fromEpochDays(startDay).toString()
    val endS = LocalDate.fromEpochDays(today.toEpochDays() - (dow + 1)).toString()
    val prevStartS = LocalDate.fromEpochDays(startDay - 7).toString()
    fun inWeek(date: String) = date >= startS && date <= endS

    val workouts = d.calendar.days.count { inWeek(it.date) && it.status == "done" }
    fun mean(xs: List<Double>): Double? = if (xs.isEmpty()) null else xs.sum() / xs.size
    val wNow = mean(d.weight.points.filter { inWeek(it.date) }.map { it.kg })
    val wPrev = mean(d.weight.points.filter { it.date >= prevStartS && it.date < startS }.map { it.kg })
    val weightDelta = if (wNow != null && wPrev != null) round1(wNow - wPrev) else null
    val foodDays = d.macros.days.filter { inWeek(it.date) && it.kcal > 0 }.map { it.date }.toSet().size
    val records = d.exercises.filter { e ->
        val before = e.points.filter { it.date < startS }.map { it.e1rm }
        val during = e.points.filter { inWeek(it.date) }.map { it.e1rm }
        before.isNotEmpty() && during.isNotEmpty() && during.max() > before.max() + 1e-9
    }.map { it.name }
    val planned = d.calendar.split.map { it.weekday }.filter { it > 0 }.toSet().size
    val weighIns = d.weight.points.count { inWeek(it.date) }
    val focus = when {
        planned > 0 && workouts < planned -> WeekFocus.Workouts
        weighIns < 3 -> WeekFocus.Weigh
        foodDays < 5 -> WeekFocus.Food
        else -> WeekFocus.Keep
    }
    return WeekSummary(startS, endS, workouts, planned, weightDelta, foodDays, records, focus)
}

private fun round1(x: Double): Double = (x * 10).roundToLong() / 10.0

/** Signed kg change for the card, with the Unicode minus the Mini App uses. */
fun formatKgDelta(delta: Double): String {
    val sign = if (delta > 0) "+" else if (delta < 0) "−" else ""
    val magnitude = abs(delta)
    val text = if (magnitude == magnitude.toLong().toDouble()) magnitude.toLong().toString() else (round1(magnitude)).toString()
    return "$sign$text kg"
}

/** Badges earned but not yet celebrated. The seen set is kept on the device; the very first run
 * records everything as seen without celebrating, so an old account isn't greeted by pop-ups. */
data class BadgeSeen(val show: List<String>, val seen: List<String>)

fun unseenBadges(earned: List<String>, seenRaw: String?): BadgeSeen {
    val seen = seenRaw?.let { runCatching { AppJson.decodeFromString<List<String>>(it) }.getOrNull() }
        ?: return BadgeSeen(emptyList(), earned)
    val have = seen.toSet()
    return BadgeSeen(earned.filter { it !in have }, (seen + earned).distinct())
}
