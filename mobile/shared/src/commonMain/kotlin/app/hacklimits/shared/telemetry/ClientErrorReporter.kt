package app.hacklimits.shared.telemetry

import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Sends app crashes to POST /api/v2/client-error so they reach the owner's error report. Each distinct
 * message goes once per app session, at most [MAX_REPORTS] in total; network noise and failed API
 * calls are dropped (the server already logs those). Never throws.
 */
class ClientErrorReporter(private val api: ApiClient, private val scope: CoroutineScope) {
    private val seen = mutableSetOf<String>()

    fun report(error: Throwable, source: String? = null, line: Int? = null) {
        if (error is ApiException) return
        val message = errorMessage(error, seen) ?: return
        scope.launch {
            if (api.bearer() == null) return@launch
            runCatching {
                api.http.post("api/v2/client-error") {
                    api.authorize(this)
                    contentType(ContentType.Application.Json)
                    setBody(buildJsonObject {
                        put("message", message)
                        source?.takeIf { it.isNotBlank() }?.let { put("source", it) }
                        line?.takeIf { it > 0 }?.let { put("line", it) }
                    })
                }
            }
        }
    }

    companion object {
        const val MAX_REPORTS = 5
        private const val MAX_MESSAGE = 150
        private val NOISE = Regex("Timeout|timed out|Connect|Unresolved|Socket|Failed to fetch|NetworkError|Load failed|AbortError|operation was aborted", RegexOption.IGNORE_CASE)

        /**
         * The message to send for this error, or null to skip it (noise, a repeat, over the cap).
         * Records the message in [seen] when it is sent.
         */
        internal fun errorMessage(error: Throwable, seen: MutableSet<String>): String? {
            if (seen.size >= MAX_REPORTS) return null
            val body = error.message?.trim().orEmpty()
            if (body.isEmpty()) return null
            val name = error::class.simpleName.orEmpty()
            val raw = if (name.isNotEmpty() && name != "Exception" && name != "Throwable") "$name: $body" else body
            val message = raw.replace(Regex("\\s+"), " ").trim().take(MAX_MESSAGE)
            if (NOISE.containsMatchIn(message) || !seen.add(message)) return null
            return message
        }
    }
}
