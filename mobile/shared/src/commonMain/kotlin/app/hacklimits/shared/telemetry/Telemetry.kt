package app.hacklimits.shared.telemetry

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Feature-usage counters for POST /api/v2/event: which features people use, so the owner keeps what
 * works. Names must match the server's allowlist (`app_` plus 2-40 lowercase letters, digits, `_`).
 * Events are batched: one tick after the first event, at most [BATCH] per request. Fire-and-forget;
 * never throws, and nothing is sent without a signed-in session.
 */
class Telemetry(private val api: ApiClient, private val scope: CoroutineScope) {
    private val lock = Mutex()
    private val queue = mutableListOf<String>()
    private var timer: Job? = null

    fun track(event: String) {
        if (!isValidEvent(event)) return
        scope.launch {
            lock.withLock {
                queue += event
                if (timer?.isActive == true) return@launch
                timer = scope.launch {
                    delay(TICK_MS)
                    flushTick()
                }
            }
        }
    }

    private suspend fun flushTick() {
        val batch = lock.withLock {
            val taken = queue.take(BATCH)
            queue.subList(0, taken.size).clear()
            taken
        }
        if (batch.isNotEmpty()) send(batch)
        // Anything left over goes out on the next tick instead of waiting for another track() call.
        if (lock.withLock { queue.isNotEmpty() }) {
            lock.withLock { timer = scope.launch { delay(TICK_MS); flushTick() } }
        }
    }

    private suspend fun send(batch: List<String>) {
        if (api.bearer() == null) return
        runCatching {
            api.http.post("api/v2/event") {
                api.authorize(this)
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject {
                    put("events", JsonArray(batch.map { JsonPrimitive(it) }))
                })
            }
        }
    }

    companion object {
        const val BATCH = 10
        private const val TICK_MS = 400L
        private val EVENT = Regex("^app_[a-z0-9_]{2,40}$")

        fun isValidEvent(event: String): Boolean = EVENT.matches(event)
    }
}
