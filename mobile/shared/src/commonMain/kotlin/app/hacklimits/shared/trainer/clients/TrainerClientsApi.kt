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
    /** Two missed planned dates, when the client is at risk for missed workouts. */
    val missedDates: List<String>? = null,
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

/** GET /api/v2/trainer/client/{id}/card. Fields the card screen does not show are left out. */
@Serializable
data class ClientCard(
    val client: CardClient,
    val note: String? = null,
    val card: CardNotes? = null,
    val draft: Draft? = null,
    val cycle: Cycle? = null,
    val shared: Shared = Shared(),
    val noteHistory: List<NoteEntry> = emptyList(),
    val photos: List<Photo>? = null,
    val dashboard: Dashboard? = null,
) {
    @Serializable data class CardClient(val id: Long, val name: String, val onboarded: Boolean = false, val flagged: Boolean = false)
    @Serializable data class CardNotes(val healthNotes: String? = null, val personalNotes: String? = null, val birthday: String? = null)
    @Serializable
    data class Draft(
        val days: Int,
        val exercises: Int,
        val createdAt: String,
        val autoActivatesAt: String? = null,
        val postponed: Boolean = false,
    )
    @Serializable data class Cycle(val phase: String, val day: Int)
    @Serializable data class NoteEntry(val field: String, val value: String, val savedAt: String)
    @Serializable data class Photo(val id: Long, val takenAt: String)

    /** The readiness numbers only; the rest of the client's dashboard is ignored. */
    @Serializable
    data class Dashboard(val recovery: Recovery? = null, val gamification: Gamification? = null) {
        @Serializable data class Recovery(val score: Double = 0.0, val label: String = "fair")
        @Serializable data class Gamification(val level: Int = 1, val streak: Int? = null)
    }

    @Serializable
    data class Shared(val body: Body? = null, val health: Health? = null) {
        @Serializable data class Body(val heightCm: Double? = null, val weightKg: Double? = null, val age: Double? = null)
        @Serializable data class Health(val limitations: String? = null, val injuries: List<Injury> = emptyList())
        @Serializable data class Injury(val area: String, val severity: String, val since: String)
    }
}

@Serializable private data class ClientsEnvelope(val trainer: ClientsBlock? = null)
@Serializable private data class ClientsBlock(val clients: List<ClientRow> = emptyList())
@Serializable private data class RequestsBody(val requests: List<TrainerRequest> = emptyList())
@Serializable private data class QuestionsBody(val questions: List<TrainerQuestion> = emptyList())
@Serializable private data class UnreadBody(val bySender: Map<String, Int> = emptyMap())

/**
 * The trainer's client-side endpoints. Every mutation sends an Idempotency-Key so a retried tap
 * (lost response) is not applied twice; the caller makes a fresh key per user action.
 */
class TrainerClientsApi(private val api: ApiClient) {
    /** Only the trainer block of the dashboard is read here; the rest of the payload is ignored. */
    suspend fun clients(): List<ClientRow> =
        api.unwrap<ClientsEnvelope>(api.http.get("api/v2/dashboard") { api.authorize(this) }).trainer?.clients ?: emptyList()

    /** Unread chat messages per client id. */
    suspend fun chatUnread(): Map<Long, Int> =
        api.unwrap<UnreadBody>(api.http.get("api/v2/chat/unread") { api.authorize(this) })
            .bySender.mapNotNull { (id, count) -> id.toLongOrNull()?.let { it to count } }.toMap()

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

    /** The trainer's call on the waiting plan draft: "assign", "postpone" or "discard". */
    suspend fun decideDraft(clientId: Long, decision: String, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/draft", key, buildJsonObject { put("decision", decision) }))
    }

    /** The server reads a JSON body on every trainer POST, so these send an empty object. */
    suspend fun requestPhoto(clientId: Long, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/photo-request", key, JsonObject(emptyMap())))
    }

    suspend fun nudgeInterview(clientId: Long, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/client/$clientId/interview-nudge", key, JsonObject(emptyMap())))
    }

    /** Saves the client's current active plan as a reusable template. 404 when there is no active plan. */
    suspend fun createTemplate(clientId: Long, name: String, key: String) {
        api.unwrap<JsonElement>(post("api/v2/trainer/templates", key, buildJsonObject {
            put("action", "create")
            put("name", name)
            put("fromClientId", clientId)
        }))
    }

    suspend fun invite(): TrainerInvite = api.unwrap(api.http.get("api/v2/trainer/invite") { api.authorize(this) })

    suspend fun createInvite(name: String, key: String): ProspectInvite =
        api.unwrap(post("api/v2/trainer/invite", key, buildJsonObject { put("name", name) }))

    /** Progress photos are fetched with the bearer header, so the caller passes [bearer] to the image loader. */
    fun photoUrl(id: Long): String = api.url("api/v2/photo?id=$id")

    suspend fun bearer(): String? = api.bearer()

    private suspend fun post(path: String, key: String, body: JsonElement) = api.http.post(path) {
        api.authorize(this)
        header("Idempotency-Key", key)
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
