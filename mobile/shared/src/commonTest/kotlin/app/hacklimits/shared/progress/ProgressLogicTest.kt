package app.hacklimits.shared.progress

import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.TrainingPlanDay
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.progress.body.dayMuscles
import app.hacklimits.shared.progress.body.pickerGroups
import app.hacklimits.shared.progress.muscle.LearnedMuscles
import app.hacklimits.shared.progress.muscle.LoggedDay
import app.hacklimits.shared.progress.muscle.LoggedExercise
import app.hacklimits.shared.progress.muscle.MUSCLE_LANDMARKS
import app.hacklimits.shared.progress.muscle.lopsidedPairs
import app.hacklimits.shared.progress.muscle.muscleRecovery
import app.hacklimits.shared.muscles.classify
import app.hacklimits.shared.progress.muscle.registerLearnedMuscles
import app.hacklimits.shared.progress.muscle.weeklyMuscleSeries
import app.hacklimits.shared.progress.muscle.weeklyMuscleSets
import app.hacklimits.shared.progress.muscle.weekBalance
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProgressLogicTest {
    private fun log(date: String, vararg ex: Pair<String, Int>) = LoggedDay(date, true, ex.map { LoggedExercise(it.first, it.second) })

    @Test
    fun squatLoadsQuadsAndGlutesAndUnknownNamesLoadNothing() {
        assertTrue("quadriceps" in assertNotNull(classify("Squat")).primary)
        assertTrue("chest" in assertNotNull(classify("Bench press")).primary)
        assertNull(classify("zzqqxx"))
    }

    @Test
    fun learnedMusclesFillOnlyWhatTheRulesMiss() {
        registerLearnedMuscles(listOf(LearnedMuscles("Club Gizmo", primary = listOf("forearm", "not-a-slug"))))
        assertEquals(listOf("forearm"), assertNotNull(classify("club gizmo")).primary)
    }

    @Test
    fun weeklySetsCountHelpersAsHalfAndRoundToHalves() {
        val week = weeklyMuscleSets(listOf(log("2026-10-19", "Squat" to 3)), since = "2026-10-13")
        val quads = week.first { it.slug == "quadriceps" }
        assertEquals(3.0, quads.sets)
        assertEquals("below", quads.zone) // MEV 8
        assertEquals(MUSCLE_LANDMARKS.getValue("quadriceps").mev, quads.mev)
    }

    @Test
    fun aLogBeforeTheWindowDoesNotCount() {
        val week = weeklyMuscleSets(listOf(log("2026-10-01", "Squat" to 3)), since = "2026-10-13")
        assertEquals(0.0, week.first { it.slug == "quadriceps" }.sets)
    }

    @Test
    fun recoveryCountsCalendarDaysSinceTheLastLoad() {
        val recovery = muscleRecovery(listOf(log("2026-10-18", "Squat" to 3)), today = "2026-10-20")
        val quads = recovery.first { it.slug == "quadriceps" }
        assertEquals("almost", quads.status)
        assertEquals(2, quads.daysAgo)
        assertEquals(listOf("Squat"), quads.exercises)
        assertEquals("ready", recovery.first { it.slug == "chest" }.status)
    }

    @Test
    fun weeklySeriesBucketsByWeekEndingOnToday() {
        val series = weeklyMuscleSeries(listOf(log("2026-10-19", "Squat" to 4)), today = "2026-10-20", weeks = 12)
        assertEquals(12, series.weekEnds.size)
        assertEquals("2026-10-20", series.weekEnds.last())
        assertEquals(4.0, series.series.getValue("quadriceps").last())
    }

    @Test
    fun lopsidedPairsNeedAStrongSideWithVolume() {
        val pairs = lopsidedPairs({ slug -> if (slug == "chest") 10.0 else if (slug == "upper-back") 4.0 else 0.0 })
        assertEquals("upper-back", pairs.single().weak)
        assertFalse(lopsidedPairs({ 2.0 }).isNotEmpty())
    }

    @Test
    fun weekBalanceIsZeroWithNothingLogged() {
        val balance = weekBalance(emptyList(), since = "2026-10-13")
        assertEquals(0, balance.balance)
        assertEquals(0.0, balance.trainedSets)
    }

    @Test
    fun dayMusclesKeepUnknownNamesAndDropSecondariesThatArePrimary() {
        val day = dayMuscles(listOf("Squat", "zzqqxx")) { classify(it) }
        assertEquals(listOf("zzqqxx"), day.unknown)
        assertTrue("quadriceps" in day.primary)
        assertFalse(day.secondary.any { it in day.primary })
    }

    @Test
    fun pickerGroupsListEachNameOnceUnderItsDay() {
        val plan = listOf(
            TrainingPlanDay(weekday = 3, muscleGroup = "Push", exercises = listOf(TrainingPlanDay.PlanExercise("Bench press"), TrainingPlanDay.PlanExercise("Squat"))),
            TrainingPlanDay(weekday = 1, name = "Pull", exercises = listOf(TrainingPlanDay.PlanExercise("Row"))),
        )
        val groups = pickerGroups(plan, recent = listOf("squat", "Curl"))
        assertEquals(listOf(1, 3, null), groups.map { it.weekday })
        assertEquals(listOf("Bench press", "Squat"), groups[1].dayNames)
        assertEquals(listOf("Curl"), groups.last().names)
    }

    @Test
    fun weightChartDeltaIsTheChangeOfTheSevenDayAverage() {
        val points = listOf(ProgressDashboard.Weight.Point("2026-10-18", 80.0), ProgressDashboard.Weight.Point("2026-10-19", 79.0))
        val model = assertNotNull(weightChartModel(points, goal = null))
        assertEquals(-0.5, model.deltaKg)
        assertNull(model.goalY)
        assertEquals(1, model.spanDays)
    }

    @Test
    fun weightChartNeedsTwoWeighIns() {
        assertNull(weightChartModel(listOf(ProgressDashboard.Weight.Point("2026-10-18", 80.0)), goal = null))
    }

    @Test
    fun photoPairIsNewestAgainstTheOneClosestToAMonthBefore() {
        val photos = listOf(PhotoRef(1, "2026-09-20"), PhotoRef(2, "2026-10-01"), PhotoRef(3, "2026-10-20"))
        val pair = assertNotNull(pickPhotoPair(photos))
        assertEquals(1L, pair.before.id)
        assertEquals(3L, pair.after.id)
        assertEquals(30, pair.days)
    }

    @Test
    fun photoPairNeedsTwoPhotos() {
        assertNull(pickPhotoPair(listOf(PhotoRef(1, "2026-10-20"))))
    }

    @Test
    fun weightNearUsesAThreeDayWindow() {
        val points = listOf(ProgressDashboard.Weight.Point("2026-10-01", 80.0))
        assertEquals(80.0, weightNear(points, "2026-10-03"))
        assertNull(weightNear(points, "2026-10-10"))
    }

    @Test
    fun theWeekStartsOnMonday() {
        assertEquals("2026-10-19", mondayOf("2026-10-20")) // 2026-10-20 is a Tuesday
    }

    @Test
    fun formatOneDecimalKeepsAtMostOneDigit() {
        assertEquals("82", formatOneDecimal(82.0))
        assertEquals("82.5", formatOneDecimal(82.5))
    }
}
