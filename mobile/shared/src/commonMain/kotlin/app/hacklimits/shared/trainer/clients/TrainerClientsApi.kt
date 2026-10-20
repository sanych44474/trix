package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Response shapes follow packages/contracts/openapi.yaml; unknown fields are ignored by AppJson,
// so the server can add fields without breaking the app.

/** A row of the trainer's client list, from the `trainer.clients` block of GET /api/v2/dashboard. */
@Serializable
data class ClientRow(
    val id: Long,
    val name: String,
    val workoutPct: Double = 0.0,
    val nutritionPct: Double = 0.0,
    val atRisk: Boolean = false,
    val flagged: Boolean = false,
    val onboarded: Boolean = false,
    val plan: String = "none",
)

@Serializable data class TrainerRequest(val id: Long, val clientId: Long, val name: String, val note: String = "")

@Serializable
data class TrainerQuestion(
    val id: Long,
    val clientId: Long,
    val client: String,
    val text: String,
    val draft: String = "",
    val status: String,
)

@Serializable
data class ProspectInvite(val name: String, val link: String, val createdAt: String)

@Serializable
data class TrainerInvite(
    val link: String = "",
    val shareText: String = "",
    val approved: Boolean = false,
    val accepting: Boolean = false,
    val clients: Int = 0,
    val maxClients: Int? = null,
    val prospects: List<ProspectInvite> = emptyList(),
)

/** GET /api/v2/trainer/client/{id}/card — only the fields the card screen shows. */
@Serializable
data class ClientCard(
    val client: CardClient,
    val note: String? = null,
    val card: CardNotes? = null,
    val draft: Draft? = null,
    val shared: Shared = Shared(),
) {
    @Serializable data class CardClient(val id: Long, val name: String, val onboarded: Boolean = false, val flagged: Boolean = false)
    @Serializable data class CardNotes(val healthNotes: String? = null, val personalNotes: String? = null, val birthday: String? = null)
    @Serializable data class Draft(val days: Int, val exercises: Int, val createdAt: String)
    @Serializable data class Shared(val body: Body? = null, val health: Health? = null) {
        @Serializable data class Body(val heightCm: Double? = null, val weightKg: Double? = null, val goalWeight: Double? = null)
        @Serializable data class Health(val limitations: String? = null, val injuries: List<Injury> = emptyList())
        @Serializable data class Injury(val area: String, val severity: String, val since: String)
    }
}

@Serializable private data class ClientsEnvelope(val trainer: ClientsBlock? = null)
@Serializable private data class ClientsBlock(val clients: List<ClientRow> = emptyList())
@Serializable private data class RequestsBody(val requests: List<TrainerRequest> = emptyList())
@Serializable private data class QuestionsBody(val questions: List<TrainerQuestion> = emptyList())
@Serializable private data class NudgeResult(val ok: Boolean = true, val alreadyOnboarded: Boolean = false)

/**
 * The trainer's client-side endpoints. Every mutation sends an Idempotency-Key so a retried tap
 * (lost response) is not applied twice; the caller makes a fresh key per user action.
 */
class TrainerClientsApi(private val api: ApiClient) {
    /** Only the trainer block of the dashboard is read here; the rest of the payload is ignored. */
    suspend fun clients(): List<ClientRow> =
        api.unwrap<ClientsEnvelope>(api.http.get("api/v2/dashboard") { api.authorize(this) }).trainer?.clients ?: emptyList()

    suspend fun requests(): List<TrainerRequest> =
        api.unwrap<RequestsBody>(api.http.get("api/v2/requests") { api.authorize(this) }).requests

    suspend fun resolveRequest(id: Long, accept: Boolean, key: String) {
        val action = if (accept) "accept" else "decline"
        api.unwrap<JsonElement>(post("api/v2/requests", key, buildJsonObject { put("id", id); put("action", action) }))
    }

    suspend fun questions(): List<TrainerQuestion> =
        api.unwrap<QuestionsBody>(api.http.get("api/v2/trainer/questions") { api.authorize(this) }).questions

    suspend fun answer(questionId: Long, text: String, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/question/$questionId/answer", key, buildJsonObject { put("text", text) }))
    }

    suspend fun card(clientId: Long): ClientCard =
        api.unwrap(api.http.get("api/v2/trainer/client/$clientId/card") { api.authorize(this) })

    /** An empty string clears a field on the server. Birthday is YYYY-MM-DD or MM-DD. */
    suspend fun saveCard(clientId: Long, healthNotes: String, personalNotes: String, birthday: String, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/card", key, buildJsonObject {
            put("healthNotes", healthNotes)
            put("personalNotes", personalNotes)
            put("birthday", birthday)
        }))
    }

    suspend fun saveNote(clientId: Long, note: String, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/note", key, buildJsonObject { put("note", note) }))
    }

    suspend fun setFlag(clientId: Long, flagged: Boolean, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/flag", key, buildJsonObject { put("flagged", flagged) }))
    }

    /** The server reads a JSON body on every trainer POST, so these send an empty object. */
    suspend fun requestPhoto(clientId: Long, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/photo-request", key, JsonObject(emptyMap())))
    }

    /** True when the client already finished the questionnaire, so nothing was sent. */
    suspend fun nudgeInterview(clientId: Long, key: String): Boolean =
        api.unwrap<NudgeResult>(post("api/v2/trainer/client/$clientId/interview-nudge", key, JsonObject(emptyMap()))).alreadyOnboarded

    suspend fun invite(): TrainerInvite = api.unwrap(api.http.get("api/v2/trainer/invite") { api.authorize(this) })

    suspend fun createInvite(name: String, key: String): ProspectInvite =
        api.unwrap(post("api/v2/trainer/invite", key, buildJsonObject { put("name", name) }))

    private suspend fun post(path: String, key: String, body: JsonElement) = api.http.post(path) {
        api.authorize(this)
        header("Idempotency-Key", key)
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
