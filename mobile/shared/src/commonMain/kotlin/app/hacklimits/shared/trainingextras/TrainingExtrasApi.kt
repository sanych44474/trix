package app.hacklimits.shared.trainingextras

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A quick-log cardio type. [name] is the prefix the free-text line takes ("" for other); [label] is the caption. */
@Serializable
data class CardioType(val key: String, val name: String = "", val label: String = "")

@Serializable
data class Bpm(val lo: Int, val hi: Int)

@Serializable
data class CardioStep(val label: String, val minutes: Int, val zone: Int, val reps: Int = 1, val bpm: Bpm)

@Serializable
data class CardioTemplate(val key: String, val emoji: String = "", val name: String, val totalMin: Int, val steps: List<CardioStep> = emptyList())

@Serializable
data class CardioStructured(val intro: String = "", val zoneNote: String = "", val templates: List<CardioTemplate> = emptyList())

/** GET /api/v2/cardio (src/webapp/trainingExtrasApi.ts). Names and labels are in the user's language. */
@Serializable
data class Cardio(val quick: List<CardioType> = emptyList(), val structured: CardioStructured = CardioStructured(), val bpmLabel: String = "")

/** One big lift against the bodyweight levels. [nextLabel] and [nextTargetKg] are absent at the top level. */
@Serializable
data class LiftStandard(
    val exercise: String,
    val e1rm: Int,
    val ratio: Double,
    val levelLabel: String,
    val nextLabel: String? = null,
    val nextTargetKg: Int? = null,
)

/** GET /api/v2/standards. [needsWeight] is true when no bodyweight is known; [lifts] is then empty. */
@Serializable
data class Standards(val needsWeight: Boolean = false, val bodyweight: Int? = null, val lifts: List<LiftStandard> = emptyList())

@Serializable
data class ComebackChoice(val value: String, val label: String)

@Serializable
data class ComebackQuestion(val key: String, val kind: String, val question: String, val buttons: List<ComebackChoice> = emptyList())

/** GET /api/v2/comeback. [pending] is true while the bot would be asking the interview. */
@Serializable
data class Comeback(val pending: Boolean = false, val steps: List<ComebackQuestion> = emptyList())

/** POST /api/v2/comeback result. [planPending] is true when a plan rebuild has started in the background. */
@Serializable
data class ComebackResult(val ok: Boolean = false, val decision: String = "", val planPending: Boolean = false)

@Serializable
private data class LogResult(val ok: Boolean = false, val reason: String? = null)

/** The training-extras routes. Every call goes through ApiClient.unwrap, so errors arrive as ApiException. */
class TrainingExtrasApi(private val api: ApiClient) {
    suspend fun cardio(): Cardio = api.unwrap(api.http.get("api/v2/cardio") { api.authorize(this) })

    suspend fun standards(): Standards = api.unwrap(api.http.get("api/v2/standards") { api.authorize(this) })

    suspend fun comeback(): Comeback = api.unwrap(api.http.get("api/v2/comeback") { api.authorize(this) })

    /** True when the line was saved; false when the text carried no time or distance (the server's "unreadable"). */
    suspend fun logCardio(type: String, text: String, key: String): Boolean {
        val body = buildJsonObject { put("kind", "cardio"); put("key", type); put("text", text) }
        val result: LogResult = api.unwrap(post("api/v2/log", body, key))
        return result.ok
    }

    /** All four answers and the decision (keep, adjust or recreate) in one call; the retry key makes it safe to resend. */
    suspend fun answerComeback(answers: Map<String, String>, decision: String, key: String): ComebackResult {
        val body = buildJsonObject {
            put("answers", buildJsonObject { answers.forEach { (k, v) -> put(k, v) } })
            put("decision", decision)
        }
        return api.unwrap(post("api/v2/comeback", body, key))
    }

    private suspend fun post(path: String, body: JsonObject, key: String): HttpResponse = api.http.post(path) {
        api.authorize(this)
        header("Idempotency-Key", key)
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
