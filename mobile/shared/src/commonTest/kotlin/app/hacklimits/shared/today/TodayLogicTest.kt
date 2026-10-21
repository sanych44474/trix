package app.hacklimits.shared.today

import app.hacklimits.shared.data.Dashboard
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TodayLogicTest {
    // 2026-10-20 is a Tuesday; its week runs 2026-10-19 (Mon) to 2026-10-25 (Sun).
    private val today = "2026-10-20"

    private fun input(
        planExercises: List<String> = listOf("Squat"),
        days: List<Dashboard.Calendar.Day> = emptyList(),
        logs: List<Dashboard.Calendar.Log> = emptyList(),
        session: SessionProgress? = null,
    ) = TodayInput(today, planExercises, plannedWeekdays = listOf(1, 3, 5), days = days, logs = logs, session = session)

    @Test
    fun aPlannedDayWithNothingLoggedStartsTheWorkout() {
        val plan = todayPlan(input(days = listOf(Dashboard.Calendar.Day("2026-10-19", "done"))))
        assertEquals(TodayState.Start, plan.state)
        assertEquals(listOf("Squat"), plan.exercises)
        assertEquals(1, plan.weekDone)
        assertEquals(3, plan.weekPlanned)
    }

    @Test
    fun theWeekMarksDoneMissedPlannedAndRestDaysAndTodayIsFlagged() {
        val plan = todayPlan(input(days = listOf(Dashboard.Calendar.Day("2026-10-19", "done"), Dashboard.Calendar.Day("2026-10-13", "missed"))))
        assertEquals(listOf(DayMark.Done, DayMark.Rest, DayMark.Planned, DayMark.Rest, DayMark.Planned, DayMark.Rest, DayMark.Rest), plan.week.map { it.mark })
        assertEquals(true, plan.week[1].today)
        assertEquals("2026-10-19", plan.week.first().date)
    }

    @Test
    fun aPastMissedPlanDayIsMarkedMissed() {
        val plan = todayPlan(input(days = listOf(Dashboard.Calendar.Day("2026-10-19", "missed"))))
        assertEquals(DayMark.Missed, plan.week.first().mark)
    }

    @Test
    fun aLoggedTodayIsDoneWithItsSetsAndExercises() {
        val log = Dashboard.Calendar.Log(
            date = today, done = true,
            ex = listOf(Dashboard.Calendar.Log.LogExercise("Squat", 3), Dashboard.Calendar.Log.LogExercise("Row", 2)),
        )
        val plan = todayPlan(input(logs = listOf(log)))
        assertEquals(TodayState.Done, plan.state)
        assertEquals(5, plan.sets)
        assertEquals(2, plan.started)
        assertEquals(listOf("Squat", "Row"), plan.exercises)
        assertEquals(DayMark.Done, plan.week[1].mark)
    }

    @Test
    fun aSessionUnderWayTodayContinuesWithTheSetsFilledSoFar() {
        val session = SessionProgress(today, listOf(SessionProgress.SessionExercise("Squat", 2), SessionProgress.SessionExercise("Row", 0)))
        val plan = todayPlan(input(session = session))
        assertEquals(TodayState.Continue, plan.state)
        assertEquals(2, plan.sets)
        assertEquals(1, plan.started)
        assertEquals(listOf("Squat", "Row"), plan.exercises)
    }

    @Test
    fun aSessionWithNoFilledSetsOrFromAnotherDayDoesNotContinue() {
        assertEquals(TodayState.Start, todayPlan(input(session = SessionProgress(today, listOf(SessionProgress.SessionExercise("Squat", 0))))).state)
        assertEquals(TodayState.Start, todayPlan(input(session = SessionProgress("2026-10-19", listOf(SessionProgress.SessionExercise("Squat", 4))))).state)
    }

    @Test
    fun noPlanExercisesMeansARestDay() {
        val plan = todayPlan(input(planExercises = emptyList()))
        assertEquals(TodayState.Rest, plan.state)
        assertEquals(emptyList(), plan.exercises)
    }

    @Test
    fun lastWeekSummaryCountsWorkoutsWeightFoodAndRecords() {
        val d = Dashboard(
            viewer = Dashboard.Viewer(id = 1, role = "solo", onboarded = true),
            today = "2026-10-21", // Wednesday
            calendar = Dashboard.Calendar(
                days = listOf(
                    Dashboard.Calendar.Day("2026-10-12", "done"),
                    Dashboard.Calendar.Day("2026-10-13", "missed"),
                    Dashboard.Calendar.Day("2026-10-14", "done"),
                ),
                split = listOf(Dashboard.Calendar.Split(1, "push"), Dashboard.Calendar.Split(3, "legs"), Dashboard.Calendar.Split(5, "pull")),
            ),
            weight = Dashboard.Weight(points = listOf(
                Dashboard.Weight.Point("2026-10-07", 81.5),
                Dashboard.Weight.Point("2026-10-13", 80.0),
                Dashboard.Weight.Point("2026-10-15", 81.0),
            )),
            macros = Dashboard.Macros(days = listOf(
                Dashboard.Macros.FoodDay("2026-10-12", kcal = 2000.0),
                Dashboard.Macros.FoodDay("2026-10-13", kcal = 0.0),
            )),
            exercises = listOf(Dashboard.Exercise("Bench", listOf(
                Dashboard.Exercise.Point("2026-10-01", 100.0),
                Dashboard.Exercise.Point("2026-10-14", 105.0),
            ))),
        )
        val s = lastWeekSummary(d)
        assertEquals("2026-10-12", s.start)
        assertEquals("2026-10-18", s.end)
        assertEquals(2, s.workouts)
        assertEquals(3, s.planned)
        assertEquals(-1.0, s.weightDelta)
        assertEquals(1, s.foodDays)
        assertEquals(listOf("Bench"), s.records)
        assertEquals(WeekFocus.Workouts, s.focus)
    }

    @Test
    fun theFocusFallsBackToWeighingWhenTheWeekWasFullyWorked() {
        val d = Dashboard(
            viewer = Dashboard.Viewer(id = 1, role = "solo", onboarded = true),
            today = "2026-10-21",
            calendar = Dashboard.Calendar(
                days = listOf(Dashboard.Calendar.Day("2026-10-12", "done")),
                split = listOf(Dashboard.Calendar.Split(1, "push")),
            ),
        )
        val s = lastWeekSummary(d)
        assertNull(s.weightDelta)
        assertEquals(WeekFocus.Weigh, s.focus)
    }

    @Test
    fun theFirstRunCelebratesNothingAndRemembersEverything() {
        val result = unseenBadges(listOf("a", "b"), seenRaw = null)
        assertEquals(emptyList(), result.show)
        assertEquals(listOf("a", "b"), result.seen)
    }

    @Test
    fun onlyNewBadgesAreCelebrated() {
        val result = unseenBadges(listOf("a", "b", "c"), seenRaw = "[\"a\"]")
        assertEquals(listOf("b", "c"), result.show)
        assertEquals(listOf("a", "b", "c"), result.seen)
    }

    @Test
    fun aCorruptSeenListIsTreatedAsAFirstRun() {
        val result = unseenBadges(listOf("a"), seenRaw = "not json")
        assertEquals(emptyList(), result.show)
    }

    @Test
    fun decimalsAndHalvesFormatLikeTheMiniApp() {
        assertEquals("1.5", formatDecimal(1.5))
        assertEquals("2", formatDecimal(2.0))
        assertEquals("2.5", formatHalf(2.5))
        assertEquals("3", formatHalf(3.0))
        assertEquals("−1 kg", formatKgDelta(-1.0))
        assertEquals("+2 kg", formatKgDelta(2.0))
        assertEquals("+0.5 kg", formatKgDelta(0.5))
    }
}
