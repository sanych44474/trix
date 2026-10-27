package app.hacklimits.shared.today

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.workout.logic.DRAFT_KEY
import app.hacklimits.shared.workout.logic.LoggerDraft
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.LoggerSet
import app.hacklimits.shared.workout.logic.isSetFilled
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TodayPrefsSessionTest {
    private val today = "2026-10-20"

    private fun draftJson(draft: LoggerDraft): String = AppJson.encodeToString(draft)

    private fun exercise(name: String, vararg sets: LoggerSet) =
        LoggerExercise(index = 0, name = name, setsDone = sets.toList())

    @Test
    fun emptyRowsCountAsNoDoneSets() = runTest {
        val store = InMemoryKeyValueStore()
        val draft = LoggerDraft(date = today, exercises = listOf(exercise("Squat", LoggerSet(), LoggerSet())))
        store.put(DRAFT_KEY, draftJson(draft))

        val session = TodayPrefs(store).session()

        assertEquals(0, session!!.exercises.sumOf { it.filledSets })
    }

    @Test
    fun onlyFilledRowsAreCounted() = runTest {
        val store = InMemoryKeyValueStore()
        val draft = LoggerDraft(
            date = today,
            exercises = listOf(
                exercise("Squat", LoggerSet(), LoggerSet(reps = 5.0), LoggerSet(reps = 5.0)),
                exercise("Plank", LoggerSet(), LoggerSet(seconds = 30.0)),
            ),
        )
        store.put(DRAFT_KEY, draftJson(draft))

        val session = TodayPrefs(store).session()

        assertEquals(listOf(2, 1), session!!.exercises.map { it.filledSets })
    }

    @Test
    fun aBackfillDraftIsNotTodaysSession() = runTest {
        val store = InMemoryKeyValueStore()
        val draft = LoggerDraft(
            date = today,
            logDate = "2026-10-13",
            exercises = listOf(exercise("Squat", LoggerSet(reps = 5.0))),
        )
        store.put(DRAFT_KEY, draftJson(draft))

        assertNull(TodayPrefs(store).session())
    }

    @Test
    fun aNaNRepsCountsAsEmptyLikeTheMiniApp() {
        assertFalse(isSetFilled(LoggerSet(reps = Double.NaN)))
        assertTrue(isSetFilled(LoggerSet(reps = 1.0)))
    }
}
