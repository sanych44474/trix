package app.hacklimits.shared.workout

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.WorkoutToday
import app.hacklimits.shared.muscles.classify
import app.hacklimits.shared.workout.logic.ExerciseImages
import app.hacklimits.shared.workout.logic.LoggerDraft
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.LoggerSet
import app.hacklimits.shared.workout.logic.RestPrefs
import app.hacklimits.shared.workout.logic.SessionClock
import app.hacklimits.shared.workout.logic.SessionQuality
import app.hacklimits.shared.workout.logic.StartSource
import app.hacklimits.shared.workout.logic.buildSaveEntries
import app.hacklimits.shared.workout.logic.chooseStart
import app.hacklimits.shared.workout.logic.clampRest
import app.hacklimits.shared.workout.logic.density
import app.hacklimits.shared.workout.logic.fmtDuration
import app.hacklimits.shared.workout.logic.fmtRest
import app.hacklimits.shared.workout.logic.hydrateSaved
import app.hacklimits.shared.workout.logic.isoDateMinus
import app.hacklimits.shared.workout.logic.isoWeekday
import app.hacklimits.shared.workout.logic.metricFromName
import app.hacklimits.shared.workout.logic.parseDraft
import app.hacklimits.shared.workout.logic.parseRestPrefs
import app.hacklimits.shared.workout.logic.restProgress
import app.hacklimits.shared.workout.logic.restRingPct
import app.hacklimits.shared.workout.logic.scoreRest
import app.hacklimits.shared.workout.logic.sessionElapsedSec
import app.hacklimits.shared.workout.logic.suggestionFor
import app.hacklimits.shared.workout.logic.swapExercise
import app.hacklimits.shared.workout.logic.targetUse
import app.hacklimits.shared.workout.logic.copyToLoggerExercises
import app.hacklimits.shared.data.WorkoutCopyExercise
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LoggerLogicTest {
    private fun exercise(index: Int, name: String, sets: Int = 3) = WorkoutToday.Exercise(index = index, name = name, sets = sets)

    @Test
    fun restCountsDownFromTheDeadlineAndThenUp() {
        assertEquals(1, restProgress(endAtMs = 10_000, nowMs = 9_500).left)
        assertFalse(restProgress(endAtMs = 10_000, nowMs = 9_500).done)
        val over = restProgress(endAtMs = 10_000, nowMs = 12_600)
        assertTrue(over.done)
        assertEquals(2, over.over)
    }

    @Test
    fun restLengthsAreBoundedAndFormattedAsClock() {
        assertEquals(60, clampRest(0), "no value means the default")
        assertEquals(30, clampRest(5))
        assertEquals(900, clampRest(2000))
        assertEquals("1:15", fmtRest(75))
        assertEquals("1:02:05", fmtDuration(3725))
        assertEquals(50, restRingPct(targetSec = 60, leftSec = 30))
    }

    @Test
    fun restsScoreTheirStreakAgainstTheTarget() {
        val first = scoreRest(SessionQuality(), actualSec = 62, targetSec = 60)
        assertEquals(1, first.restCount)
        assertEquals(1, first.onTargetStreak)
        val missed = scoreRest(first, actualSec = 200, targetSec = 60)
        assertEquals(0, missed.onTargetStreak, "an overrun breaks the streak")
        assertEquals(1, missed.bestStreak, "but not the best one")
        assertEquals(262, missed.restTotalSec)
    }

    @Test
    fun densityIsTheShareOfTheSessionNotResting() {
        assertEquals(50, density(startedAtMs = 0, restTotalSec = 300, nowMs = 600_000))
        assertNull(density(startedAtMs = null, restTotalSec = 0, nowMs = 1_000))
    }

    @Test
    fun preferencesAreParsedDefensively() {
        assertEquals(RestPrefs(), parseRestPrefs(null))
        val prefs = parseRestPrefs("""{"reps":5,"time":70,"distance":90,"sound":true,"auto":false}""")
        assertEquals(30, prefs.reps, "clamped to the minimum")
        assertEquals(70, prefs.time)
        assertTrue(prefs.sound)
        assertFalse(prefs.auto)
    }

    @Test
    fun aSessionLongerThanFiveHoursHasNoTrustworthyClock() {
        assertEquals(3600, sessionElapsedSec(SessionClock(startedAt = 0), nowMs = 3_600_000))
        assertEquals(0, sessionElapsedSec(SessionClock(startedAt = 0), nowMs = 6 * 3_600_000L))
    }

    @Test
    fun aSwappedExerciseIsMeasuredByItsNameAndRemembersThePlanExercise() {
        assertEquals("time", metricFromName("Plank"))
        assertEquals("distance", metricFromName("Rowing"))
        assertEquals("reps", metricFromName("Barbell Rowing"), "a back lift, not cardio")
        val plan = listOf(LoggerExercise(index = 0, name = "Bench Press", target = WorkoutToday.Target(80.0, 5.0, 80.0, 5.0, "load")))
        val swapped = swapExercise(plan, index = 0, name = "Dips")
        assertEquals("Dips", swapped.single().name)
        assertEquals("Bench Press", swapped.single().planName)
        assertNull(swapped.single().target, "the old target describes the old exercise")
        assertNull(swapExercise(swapped, index = 0, name = "Bench Press").single().planName, "swapping back clears it")
    }

    @Test
    fun suggestionsComeFromRepeatLastThenTheProgressionTargetThenThePlan() {
        val target = LoggerExercise(index = 0, name = "Squat", sets = 2, reps = 8.0, weightKg = 60.0, target = WorkoutToday.Target(82.5, 5.0, 80.0, 5.0, "load"))
        assertEquals(LoggerSet(weight = 82.5, reps = 5.0), suggestionFor(target, 0))
        val repeated = target.copy(prefill = listOf(LoggerSet(weight = 90.0, reps = 3.0)))
        assertEquals(LoggerSet(weight = 90.0, reps = 3.0), suggestionFor(repeated, 4), "the last row repeats")
        val planOnly = LoggerExercise(index = 1, name = "Row", sets = 2, reps = 10.0, weightKg = 40.0)
        assertEquals(LoggerSet(weight = 40.0, reps = 10.0), suggestionFor(planOnly, 1))
    }

    @Test
    fun onlyFilledExercisesAreSaved() {
        val exercises = listOf(
            LoggerExercise(index = 0, name = "Squat", setsDone = listOf(LoggerSet(80.0, 5.0))),
            LoggerExercise(index = 1, name = "Row", setsDone = listOf(LoggerSet())),
            LoggerExercise(index = 2, name = "Plank", metric = "time", setsDone = listOf(LoggerSet(seconds = 45.0))),
        )
        assertEquals(listOf("Squat", "Plank"), buildSaveEntries(exercises).map { it.name })
    }

    @Test
    fun targetsAreCountedAsKeptOrEdited() {
        val target = WorkoutToday.Target(80.0, 5.0, 80.0, 5.0, "load")
        val kept = LoggerExercise(index = 0, name = "Squat", target = target, setsDone = listOf(LoggerSet(80.0, 5.0)))
        val edited = LoggerExercise(index = 1, name = "Row", target = target, setsDone = listOf(LoggerSet(70.0, 5.0)))
        assertEquals(1 to 1, targetUse(listOf(kept, edited)))
    }

    @Test
    fun aDraftSurvivesTheJsonRoundTripTheServerAndTheDeviceBothUse() {
        val draft = LoggerDraft(
            date = "2026-10-20",
            exercises = listOf(LoggerExercise(index = 0, name = "Squat", setsDone = listOf(LoggerSet(82.5, 5.0, rpe = 8.0)))),
            editedAt = 1_000,
            clock = SessionClock(startedAt = 500, quality = SessionQuality(restCount = 1, restTotalSec = 90)),
        )
        val json = AppJson.encodeToString(LoggerDraft.serializer(), draft)
        assertEquals(draft, parseDraft(json))
        assertNull(parseDraft("not json"))
    }

    @Test
    fun theLoggerOpensOnTheNewestOfTheDeviceDraftAndTheServerDraft() {
        val server = WorkoutToday(date = "2026-10-20", exercises = listOf(exercise(0, "Squat"), exercise(1, "Row")))
        val local = LoggerDraft(date = "2026-10-20", exercises = listOf(LoggerExercise(0, "Squat", setsDone = listOf(LoggerSet(80.0, 5.0)))), editedAt = 2_000)
        val start = chooseStart(server, local, remote = null)
        assertEquals(StartSource.LOCAL, start.source)
        assertTrue(start.drafted)
        assertEquals(1, start.exercises.size)
    }

    @Test
    fun aSavedLogEditedElsewhereBeatsAnOlderDraft() {
        val server = WorkoutToday(
            date = "2026-10-20",
            exercises = listOf(exercise(0, "Squat")),
            saved = listOf(WorkoutToday.SavedEntry("Squat", sets = listOf(WorkoutToday.PastSet(80.0, 5.0)))),
            savedAt = "2026-10-20T12:00:00.000Z",
        )
        val local = LoggerDraft(date = "2026-10-20", exercises = listOf(LoggerExercise(0, "Squat", setsDone = listOf(LoggerSet(70.0, 5.0)))), editedAt = 1_000)
        val start = chooseStart(server, local, remote = null)
        assertEquals(StartSource.SAVED, start.source)
        assertTrue(start.saved)
    }

    @Test
    fun aDraftWithNothingLoggedGivesWayToAPlanThatGrew() {
        val server = WorkoutToday(date = "2026-10-20", exercises = listOf(exercise(0, "Squat"), exercise(1, "Row")))
        val stale = LoggerDraft(date = "2026-10-20", exercises = listOf(LoggerExercise(0, "Squat")), editedAt = 1_000)
        assertEquals(StartSource.PLAN, chooseStart(server, stale, remote = null).source)
    }

    @Test
    fun aSavedDayKeepsSwappedExercisesWhereTheyWereLogged() {
        val plan = WorkoutToday(
            date = "2026-10-20",
            exercises = listOf(exercise(0, "Squat"), exercise(1, "Row"), exercise(2, "Press")),
            saved = listOf(
                WorkoutToday.SavedEntry("Squat", sets = listOf(WorkoutToday.PastSet(80.0, 5.0))),
                WorkoutToday.SavedEntry("Dips", planName = "Row", sets = listOf(WorkoutToday.PastSet(0.0, 10.0))),
            ),
        )
        assertEquals(listOf("Squat", "Dips", "Press"), hydrateSaved(plan).map { it.name })
    }

    @Test
    fun dateArithmeticFollowsTheCalendar() {
        assertEquals(2, isoWeekday("2026-10-20"), "a Tuesday")
        assertEquals("2026-10-06", isoDateMinus("2026-10-20", 14))
    }

    @Test
    fun aRepeatedPastSessionBecomesLoggerRowsWithItsSets() {
        val copied = copyToLoggerExercises(
            listOf(WorkoutCopyExercise(name = "Plank", metric = "time", sets = listOf(WorkoutToday.PastSet(0.0, 0.0, 45.0, 0.0)), rpe = 7.0)),
        ).single()
        assertEquals(listOf(LoggerSet(seconds = 45.0, rpe = 7.0)), copied.setsDone)
        assertEquals(7.0, copied.rpe)
    }

    @Test
    fun technicalLookupsMatchTheMiniAppCatalogue() {
        assertEquals(listOf("chest"), classify("Вправа на груди")?.primary)
        assertTrue(classify("Rowing")?.primary?.contains("upper-back") == true)
        val plank = ExerciseImages.match("Plank", null)
        assertEquals("Plank", plank?.id)
        assertTrue(plank?.exact == true)
        assertTrue(ExerciseImages.urls("Plank").first().startsWith("https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@"))
    }
}
