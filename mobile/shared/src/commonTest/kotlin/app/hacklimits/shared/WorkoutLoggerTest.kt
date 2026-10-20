package app.hacklimits.shared

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.data.WorkoutToday
import app.hacklimits.shared.workout.LoggedExercise
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.PendingSaves
import app.hacklimits.shared.workout.SetRow
import app.hacklimits.shared.workout.WorkoutDraft
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WorkoutLoggerTest {
    @Test
    fun prefillUsesTheProgressionTargetThenThePlan() {
        val withTarget = WorkoutToday.Exercise(index = 0, name = "Squat", sets = 3, reps = 5, weightKg = 80.0, target = WorkoutToday.Target(82.5, 5, 80.0, 5, "load"))
        assertEquals(List(3) { SetRow(weight = "82.5", reps = "5") }, LoggerViewModel.prefill(withTarget))
        val planOnly = WorkoutToday.Exercise(index = 1, name = "Row", sets = 2, reps = 10, weightKg = 40.0)
        assertEquals(List(2) { SetRow(weight = "40", reps = "10") }, LoggerViewModel.prefill(planOnly))
    }

    @Test
    fun onlyTickedSetsAreSentAndEmptyExercisesAreLeftOut() {
        val draft = WorkoutDraft(
            date = "2026-10-20", startedAtMs = 0,
            exercises = listOf(
                LoggedExercise("Squat", "reps", 90, listOf(SetRow("82,5", "5", done = true), SetRow("82.5", "5"))),
                LoggedExercise("Plank", "time", 60, listOf(SetRow(seconds = "45", done = true))),
                LoggedExercise("Row", "reps", 90, listOf(SetRow("40", "10"))),
            ),
        )
        val request = LoggerViewModel.toRequest(draft, nowMs = 3_600_000)!!
        assertEquals(listOf("Squat", "Plank"), request.entries.map { it.name })
        assertEquals(SaveWorkoutRequest.SetDone(reps = 5.0, weight = 82.5), request.entries[0].sets.single(), "a comma decimal is read")
        assertEquals(45.0, request.entries[1].sets.single().seconds)
        assertEquals(3600, request.durationSec)
        assertNull(LoggerViewModel.toRequest(draft.copy(exercises = draft.exercises.map { ex -> ex.copy(sets = ex.sets.map { it.copy(done = false) }) })))
    }

    @Test
    fun offlineSavesAreRetriedWithTheirOriginalKeyAndKeptWhileTheNetworkIsDown() = runTest {
        var online = false
        val keys = mutableListOf<String>()
        val engine = MockEngine { request ->
            if (!online) respondError(HttpStatusCode.ServiceUnavailable)
            else {
                keys += request.headers["Idempotency-Key"]!!
                respond("""{"data":{"ok":true,"prExercises":[],"newBadges":[],"level":1,"leveledUp":false,"totalWorkouts":1}}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            }
        }
        val api = WorkoutApi(ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(engine)))
        val queue = PendingSaves(InMemoryKeyValueStore(), api)
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        queue.add(PendingSaves.Pending("key-one-12345", request))

        assertEquals(0, queue.flush(), "server down: nothing sent")
        assertEquals(1, queue.count(), "and nothing lost")
        online = true
        assertEquals(1, queue.flush())
        assertEquals(0, queue.count())
        assertEquals(listOf("key-one-12345"), keys, "the original idempotency key, so a late first success can't double-save")
    }
}
