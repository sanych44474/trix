package app.hacklimits.shared

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.workout.PendingSaves
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

class WorkoutLoggerTest {
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

    @Test
    fun theServersRetryableFlagDecidesWhatIsKeptAndWhatIsDropped() = runTest {
        var status = HttpStatusCode.Forbidden
        var retryable = false
        val engine = MockEngine {
            respond(
                """{"error":{"code":"x","message":"m","retryable":$retryable}}""",
                status,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val api = WorkoutApi(ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(engine)))
        val queue = PendingSaves(InMemoryKeyValueStore(), api)
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        queue.add(PendingSaves.Pending("refused", request))
        queue.flush()
        assertEquals(0, queue.count(), "retryable false: 403 is dropped")

        status = HttpStatusCode.Conflict
        retryable = true
        queue.add(PendingSaves.Pending("in-flight", request))
        queue.flush()
        assertEquals(1, queue.count(), "retryable true: 409 is kept even though it is a 4xx")
    }

    @Test
    fun theQueueKeepsTheNewestTwentySaves() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.ServiceUnavailable) }
        val api = WorkoutApi(ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(engine)))
        val queue = PendingSaves(InMemoryKeyValueStore(), api)
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        repeat(21) { queue.add(PendingSaves.Pending("key-$it", request)) }
        assertEquals(20, queue.count())
        assertEquals(0, queue.flush())
        assertEquals(20, queue.count())
    }
}
