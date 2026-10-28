package app.hacklimits.shared

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.data.InMemoryOfflineStore
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.NoOfflineSyncScheduler
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.SyncOperation
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
    private data class TestQueue(
        val queue: PendingSaves,
        val offline: InMemoryOfflineStore,
        val sessions: InMemorySessionStore,
    )

    private fun queue(engine: MockEngine, sessions: InMemorySessionStore = InMemorySessionStore("t".repeat(64), 1L), legacy: InMemoryKeyValueStore = InMemoryKeyValueStore()): TestQueue {
        val client = ApiClient("https://api.example.test", sessions, HttpClient(engine))
        val offline = InMemoryOfflineStore()
        return TestQueue(
            PendingSaves(legacy, offline, WorkoutApi(client), NutritionApi(client), ProgressApi(client), sessions, NoOfflineSyncScheduler),
            offline,
            sessions,
        )
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
        val queue = queue(engine).queue
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
    fun permanentFailuresRemainVisibleAndRetryableFailuresStayQueued() = runTest {
        var status = HttpStatusCode.Forbidden
        var retryable = false
        val engine = MockEngine {
            respond(
                """{"error":{"code":"x","message":"m","retryable":$retryable}}""",
                status,
                headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val queue = queue(engine).queue
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        queue.add(PendingSaves.Pending("refused", request))
        queue.flush()
        assertEquals(0, queue.count(), "a permanent failure is no longer retried")
        assertEquals(1, queue.needsAttentionCount(), "but it remains available for the user")
        val attention = queue.needsAttentionOperations().single()
        assertEquals(true, queue.retry(attention), "the user can explicitly retry a failed change")
        assertEquals(1, queue.count())
        assertEquals(0, queue.needsAttentionCount())
        queue.flush()
        assertEquals(1, queue.needsAttentionCount())
        assertEquals(true, queue.discard(queue.needsAttentionOperations().single()), "discard is explicit and limited to a reviewed failure")
        assertEquals(0, queue.needsAttentionCount())

        status = HttpStatusCode.Conflict
        retryable = true
        queue.add(PendingSaves.Pending("in-flight", request))
        queue.flush()
        assertEquals(1, queue.count(), "retryable true: 409 is kept even though it is a 4xx")
    }

    @Test
    fun theQueueDoesNotSilentlyDropSavesAtTheOldLimit() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.ServiceUnavailable) }
        val queue = queue(engine).queue
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        repeat(25) { queue.add(PendingSaves.Pending("key-$it", request)) }
        assertEquals(25, queue.count())
        assertEquals(0, queue.flush())
        assertEquals(25, queue.count())
    }

    @Test
    fun pendingWorkStaysWithItsOriginalAccountAcrossAccountSwitches() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.ServiceUnavailable) }
        val owner = InMemorySessionStore("first-token", 10L)
        val setup = queue(engine, owner)
        val request = SaveWorkoutRequest(entries = listOf(SaveWorkoutRequest.Entry("Squat", listOf(SaveWorkoutRequest.SetDone(5.0, 80.0)))))
        setup.queue.add(PendingSaves.Pending("account-ten-save", request))

        owner.save("second-token", 20L)

        assertEquals(0, setup.queue.count())
        assertEquals(1, setup.offline.pendingCount(10L))
        assertEquals(0, setup.offline.pendingCount(20L))
    }

    @Test
    fun oldDeviceGlobalQueueIsClaimedOnlyOnExplicitRequest() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.ServiceUnavailable) }
        val legacy = InMemoryKeyValueStore()
        val old = PendingSaves.Pending("legacy-save", SaveWorkoutRequest(entries = emptyList()))
        legacy.put("pending_workout_saves", app.hacklimits.shared.data.AppJson.encodeToString(listOf(old)))
        val setup = queue(engine, legacy = legacy)

        assertEquals(1, setup.queue.legacyCount())
        assertEquals(0, setup.queue.count())
        assertEquals(true, setup.queue.claimLegacyForCurrentAccount())
        assertEquals(0, setup.queue.legacyCount())
        assertEquals(1, setup.queue.count())
    }

    @Test
    fun cachedRecordsAndDraftOperationsStayScopedToTheirAccount() = runTest {
        val engine = MockEngine { respondError(HttpStatusCode.ServiceUnavailable) }
        val owner = InMemorySessionStore("first-token", 10L)
        val setup = queue(engine, owner)
        val cache = AccountCache(setup.offline, owner)

        setup.offline.write(10L, "dashboard", "account-ten", 1234L)
        assertEquals(1234L, cache.lastUpdatedAt("dashboard"))
        assertEquals("account-ten", cache.read("dashboard"))

        setup.queue.queueDraft("2026-10-27", "old-draft")
        setup.queue.queueDraft("2026-10-27", "latest-draft")
        assertEquals(1, setup.offline.pendingCount(10L), "updating a draft replaces its stable outbox operation")
        assertEquals(true, setup.offline.pending(10L).single().payload.contains("latest-draft"))

        owner.save("second-token", 20L)
        assertEquals(null, cache.read("dashboard"))
        assertEquals(null, cache.lastUpdatedAt("dashboard"))
        assertEquals(0, setup.queue.count())
    }

    @Test
    fun aRetryableFailureIsParkedAfterTheAttemptCapAndTheQueueMovesOn() = runTest {
        val sent = mutableListOf<String>()
        val engine = MockEngine { request ->
            val key = request.headers["Idempotency-Key"]!!
            if (key == "key-one-12345") respondError(HttpStatusCode.ServiceUnavailable)
            else {
                sent += key
                respond("""{"data":{"ok":true,"prExercises":[],"newBadges":[],"level":1,"leveledUp":false,"totalWorkouts":1}}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            }
        }
        val setup = queue(engine)
        val request = SaveWorkoutRequest(entries = emptyList())
        setup.queue.add(PendingSaves.Pending("key-one-12345", request))
        setup.queue.add(PendingSaves.Pending("key-two-12345", request))

        repeat(PendingSaves.MAX_SYNC_ATTEMPTS - 1) {
            assertEquals(true, setup.queue.syncPending().shouldRetry, "still under the cap: the queue waits")
        }
        assertEquals(emptyList(), setup.offline.needsAttention(1L).map { it.id })

        val last = setup.queue.syncPending()
        assertEquals(listOf("key-two-12345"), sent, "the capped row no longer blocks the one behind it")
        assertEquals(1, last.sent)
        assertEquals(false, last.shouldRetry)
        assertEquals(listOf("key-one-12345"), setup.offline.needsAttention(1L).map { it.id })
        assertEquals(0, setup.queue.count())
    }

    @Test
    fun anOfflineSaveIsNeverParkedHoweverManyTriesFail() = runTest {
        val setup = queue(MockEngine { throw kotlinx.io.IOException("no network") })
        setup.queue.add(PendingSaves.Pending("key-offline-1234", SaveWorkoutRequest(entries = emptyList())))

        repeat(PendingSaves.MAX_SYNC_ATTEMPTS + 5) {
            assertEquals(true, setup.queue.syncPending().shouldRetry)
        }
        assertEquals(emptyList(), setup.offline.needsAttention(1L).map { it.id })
        assertEquals(1, setup.queue.count())
    }

    @Test
    fun removingAnAccountWipesOnlyItsCacheAndOutbox() = runTest {
        val setup = queue(MockEngine { respondError(HttpStatusCode.ServiceUnavailable) })
        setup.offline.write(10L, "dashboard", "account-ten", 1L)
        setup.offline.write(20L, "dashboard", "account-twenty", 1L)
        setup.offline.enqueue(SyncOperation(10L, "op-ten", PendingSaves.WORKOUT_KIND, "{}", 1L))
        setup.offline.enqueue(SyncOperation(20L, "op-twenty", PendingSaves.WORKOUT_KIND, "{}", 1L))

        setup.offline.removeAccount(10L)

        assertEquals(null, setup.offline.read(10L, "dashboard"))
        assertEquals(0, setup.offline.pendingCount(10L))
        assertEquals("account-twenty", setup.offline.read(20L, "dashboard"))
        assertEquals(1, setup.offline.pendingCount(20L))
    }
}
