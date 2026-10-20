package app.hacklimits.shared.today

import app.hacklimits.shared.data.Dashboard
import kotlinx.datetime.LocalDate

// What Today leads with: one workout block (start / continue / done / rest day) and the week as seven
// days. Pure, so the states are tested without rendering. Port of the Mini App's logic/todayPlan.ts.

enum class TodayState { Start, Continue, Done, Rest }
enum class DayMark { Done, Missed, Planned, Rest }

data class PlanDay(val date: String, val weekday: Int, val mark: DayMark, val today: Boolean)

data class TodayPlan(
    val state: TodayState,
    /** Exercise names for today (the plan's, or the session's once it is under way). */
    val exercises: List<String>,
    /** Exercises with at least one logged set in the session (continue) or in today's log (done). */
    val started: Int,
    /** Sets logged today (done) or so far (continue). */
    val sets: Int,
    val week: List<PlanDay>,
    val weekDone: Int,
    val weekPlanned: Int,
)

/** The workout in progress on this device: how many sets are filled per exercise. */
data class SessionProgress(val date: String, val exercises: List<SessionExercise>) {
    data class SessionExercise(val name: String, val filledSets: Int)
}

data class TodayInput(
    val today: String, // YYYY-MM-DD
    val planExercises: List<String>, // dashboard.logForm.exercises
    val plannedWeekdays: List<Int>, // ISO 1..7 from calendar.split
    val days: List<Dashboard.Calendar.Day>,
    val logs: List<Dashboard.Calendar.Log>,
    val session: SessionProgress?,
)

fun todayPlan(input: TodayInput): TodayPlan {
    val planned = input.plannedWeekdays.filter { it in 1..7 }.toSet()
    val byDate = input.days.associate { it.date to it.status }
    val todayLog = input.logs.firstOrNull { it.date == input.today && it.done }

    val today = LocalDate.parse(input.today)
    val monday = today.toEpochDays() - today.dayOfWeek.ordinal
    val week = (0..6).map { i ->
        val date = LocalDate.fromEpochDays(monday + i).toString()
        val weekday = i + 1
        val isToday = date == input.today
        val loggedDone = byDate[date] == "done" || (isToday && todayLog != null)
        val mark = when {
            loggedDone -> DayMark.Done
            date < input.today && byDate[date] == "missed" -> DayMark.Missed
            weekday in planned && date >= input.today -> DayMark.Planned
            else -> DayMark.Rest
        }
        PlanDay(date, weekday, mark, isToday)
    }
    val weekDone = week.count { it.mark == DayMark.Done }
    val weekPlanned = maxOf(planned.size, weekDone)

    if (todayLog != null) {
        return TodayPlan(
            TodayState.Done, todayLog.ex.map { it.n }, started = todayLog.ex.size,
            sets = todayLog.ex.sumOf { it.s }, week, weekDone, weekPlanned,
        )
    }
    // A session under way on this phone (today's, not an older one).
    val live = input.session?.takeIf { it.date == input.today }
    val liveSets = live?.exercises?.sumOf { it.filledSets } ?: 0
    if (live != null && liveSets > 0) {
        return TodayPlan(
            TodayState.Continue, live.exercises.map { it.name },
            started = live.exercises.count { it.filledSets > 0 }, sets = liveSets, week, weekDone, weekPlanned,
        )
    }
    if (input.planExercises.isNotEmpty()) {
        return TodayPlan(TodayState.Start, input.planExercises, 0, 0, week, weekDone, weekPlanned)
    }
    return TodayPlan(TodayState.Rest, emptyList(), 0, 0, week, weekDone, weekPlanned)
}
