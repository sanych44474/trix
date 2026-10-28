package app.hacklimits.shared.today

import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.data.InMemoryOfflineStore
import app.hacklimits.shared.data.InMemorySessionStore
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

    /** Production writes the draft through the account cache (LoggerViewModel), so the tests do too. */
    private fun accountCache(): AccountCache = AccountCache(InMemoryOfflineStore(), InMemorySessionStore("t".repeat(64), 10L))

    private fun draftJson(draft: LoggerDraft): String = AppJson.encodeToString(draft)

    private fun exercise(name: String, vararg sets: LoggerSet) =
        LoggerExercise(index = 0, name = name, setsDone = sets.toList())

    @Test
    fun emptyRowsCountAsNoDoneSets() = runTest {
        val cache = accountCache()
        val draft = LoggerDraft(date = today, exercises = listOf(exercise("Squat", LoggerSet(), LoggerSet())))
        cache.write(DRAFT_KEY, draftJson(draft))

        val session = TodayPrefs(InMemoryKeyValueStore(), cache).session()

        assertEquals(0, session!!.exercises.sumOf { it.filledSets })
    }

    @Test
    fun onlyFilledRowsAreCounted() = runTest {
        val cache = accountCache()
        val draft = LoggerDraft(
            date = today,
            exercises = listOf(
                exercise("Squat", LoggerSet(), LoggerSet(reps = 5.0), LoggerSet(reps = 5.0)),
                exercise("Plank", LoggerSet(), LoggerSet(seconds = 30.0)),
            ),
        )
        cache.write(DRAFT_KEY, draftJson(draft))

        val session = TodayPrefs(InMemoryKeyValueStore(), cache).session()

        assertEquals(listOf(2, 1), session!!.exercises.map { it.filledSets })
    }

    @Test
    fun aDraftInTheDeviceGlobalStoreIsNotTheWorkoutInProgress() = runTest {
        val store = InMemoryKeyValueStore()
        val draft = LoggerDraft(date = today, exercises = listOf(exercise("Squat", LoggerSet(reps = 5.0))))
        store.put(DRAFT_KEY, draftJson(draft))

        assertNull(TodayPrefs(store, accountCache()).session())
    }

    @Test
    fun aBackfillDraftIsNotTodaysSession() = runTest {
        val cache = accountCache()
        val draft = LoggerDraft(
            date = today,
            logDate = "2026-10-13",
            exercises = listOf(exercise("Squat", LoggerSet(reps = 5.0))),
        )
        cache.write(DRAFT_KEY, draftJson(draft))

        assertNull(TodayPrefs(InMemoryKeyValueStore(), cache).session())
    }

    @Test
    fun aNaNRepsCountsAsEmptyLikeTheMiniApp() {
        assertFalse(isSetFilled(LoggerSet(reps = Double.NaN)))
        assertTrue(isSetFilled(LoggerSet(reps = 1.0)))
    }
}
