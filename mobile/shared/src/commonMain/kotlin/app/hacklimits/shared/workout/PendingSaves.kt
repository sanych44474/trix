package app.hacklimits.shared.workout

import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.WorkoutApi
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

/**
 * Finished workouts that could not reach the server yet (no signal in the gym). Each keeps the
 * idempotency key it was first sent with, so a retry that races a slow success can't save twice.
 * Flushed when the app starts, comes back to the foreground, or saves again.
 */
class PendingSaves(private val store: KeyValueStore, private val api: WorkoutApi) {
    @Serializable
    data class Pending(val key: String, val request: SaveWorkoutRequest)

    private val lock = Mutex()

    suspend fun count(): Int = lock.withLock { load().size }

    /** The newest [MAX_QUEUED] saves; past that the oldest is dropped. Same cap as the Mini App queue. */
    suspend fun add(pending: Pending) = lock.withLock { persist((load() + pending).takeLast(MAX_QUEUED)) }

    /** Sends what it can, oldest first. A save the server says is not retryable is dropped so one bad
     * save can't block the rest; a retryable rejection or a network error stops and keeps it. Without
     * the server's `retryable` flag, 5xx, 429 and no-connection retry and any other 4xx is dropped. */
    suspend fun flush(): Int = lock.withLock {
        val queue = load().toMutableList()
        var sent = 0
        while (queue.isNotEmpty()) {
            val next = queue.first()
            try {
                api.save(next.request, next.key)
            } catch (e: ApiException) {
                val retry = e.retryable ?: (e.status == 0 || e.status == 429 || e.status >= 500)
                if (retry) break
            } catch (e: Exception) {
                break
            }
            queue.removeAt(0)
            sent++
        }
        persist(queue)
        sent
    }

    private suspend fun load(): List<Pending> =
        store.get(KEY)?.let { runCatching { AppJson.decodeFromString<List<Pending>>(it) }.getOrNull() } ?: emptyList()

    private suspend fun persist(items: List<Pending>) {
        if (items.isEmpty()) store.remove(KEY) else store.put(KEY, AppJson.encodeToString(items))
    }

    private companion object {
        const val KEY = "pending_workout_saves"
        const val MAX_QUEUED = 20
    }
}
