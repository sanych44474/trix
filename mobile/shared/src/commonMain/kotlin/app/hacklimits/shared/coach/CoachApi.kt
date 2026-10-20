package app.hacklimits.shared.coach

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.aiTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** POST /api/v2/coach/ask. A solo or trainer caller gets [answer]; a client with a trainer gets [routed]. */
@Serializable
data class CoachAnswer(val answer: String? = null, val routed: Boolean = false)

/** One earlier turn, for the coach's short memory. The server reads the last six only. */
@Serializable
data class CoachHistoryTurn(val role: String, val text: String)

/** GET /api/v2/coach/thread: the client's routed questions and the trainer's replies. */
@Serializable
data class CoachThread(
    val trainer: CoachTrainer? = null,
    val questions: List<CoachQuestion> = emptyList(),
    val messages: List<CoachMessage> = emptyList(),
)

@Serializable data class CoachTrainer(val name: String = "")
@Serializable data class CoachQuestion(val id: Int, val text: String, val status: String, val createdAt: String)
@Serializable data class CoachMessage(val fromMe: Boolean, val text: String, val createdAt: String)

@Serializable private data class AskBody(val question: String, val history: List<CoachHistoryTurn>)

class CoachApi(private val api: ApiClient) {
    /**
     * [key] makes a retry safe: the server replays the first answer (or the first routed question)
     * for the same key instead of asking the AI or the trainer twice.
     */
    suspend fun ask(question: String, history: List<CoachHistoryTurn>, key: String): CoachAnswer =
        api.unwrap(api.http.post("api/v2/coach/ask") {
            api.authorize(this)
            aiTimeout()
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(AskBody(question, history.takeLast(MAX_HISTORY)))
        })

    suspend fun thread(): CoachThread = api.unwrap(api.http.get("api/v2/coach/thread") { api.authorize(this) })

    private companion object {
        const val MAX_HISTORY = 6
    }
}
