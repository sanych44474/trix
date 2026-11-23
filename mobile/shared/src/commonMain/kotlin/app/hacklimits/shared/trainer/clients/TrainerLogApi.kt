package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.WorkoutToday
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

// A trainer logging a client's workout and turning a voice command into a proposal (ADR-0018).
// Shapes follow packages/contracts/openapi.yaml (getTrainerLog, saveTrainerLog, trainerVoiceProposal);
// every field defaults, so a field the server adds or drops never fails the screen.

/** GET /api/v2/trainer/log: the client's day, with what is already saved. */
@Serializable
data class TrainerLogDay(
    val date: String,
    val exercises: List<WorkoutToday.Exercise> = emptyList(),
    val saved: List<WorkoutToday.SavedEntry>? = null,
    /** Send back as baseSavedAt: a save made against an older copy of the day is refused (409). */
    val savedAt: String? = null,
    val savedByTrainer: Boolean = false,
    val client: Client = Client(),
) {
    @Serializable data class Client(val id: Long = 0, val name: String = "", val today: String = "")
}

@Serializable data class TrainerLogSet(val weight: Double, val reps: Int, val seconds: Int? = null, val meters: Int? = null)

@Serializable data class TrainerLogEntry(val name: String, val sets: List<TrainerLogSet>, val rpe: Double? = null, val planName: String? = null)

@Serializable
private data class SaveBody(val clientId: Long, val date: String, val entries: List<TrainerLogEntry>, val baseSavedAt: String?)

@Serializable
data class TrainerLogSaved(
    val ok: Boolean = true,
    val prExercises: List<String> = emptyList(),
    val totalWorkouts: Int = 0,
    val savedAt: String? = null,
)

@Serializable
private data class VoiceBody(val clientId: Long, val text: String, val date: String? = null)

/** POST /api/v2/trainer/voice. Nothing in it is applied until the trainer confirms. */
@Serializable
data class VoiceProposal(
    /** "workout", "plan" or "none" (then [reply] is a clarifying question). */
    val kind: String = "none",
    val transcript: String = "",
    val reply: String = "",
    val entries: List<TrainerLogEntry> = emptyList(),
    /** Already in the order to apply them one at a time. */
    val actions: List<Action> = emptyList(),
    /** The plan version to send as If-Match with each action. */
    val version: String? = null,
) {
    @Serializable
    data class Action(
        val label: String = "",
        val kind: String = "",
        val weekday: Int? = null,
        val index: Int? = null,
        val exercise: String? = null,
        val value: String? = null,
        /** The exercise expected at (weekday, index); sent as expectName. */
        val target: String? = null,
    )
}

class TrainerLogApi(private val api: ApiClient) {
    suspend fun day(clientId: Long, date: String? = null): TrainerLogDay =
        api.unwrap(api.http.get("api/v2/trainer/log") {
            api.authorize(this)
            parameter("clientId", clientId)
            if (date != null) parameter("date", date)
        })

    suspend fun save(clientId: Long, date: String, entries: List<TrainerLogEntry>, baseSavedAt: String?, key: String): TrainerLogSaved =
        api.unwrap(api.http.post("api/v2/trainer/log") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(SaveBody(clientId, date, entries, baseSavedAt))
        })

    suspend fun voice(clientId: Long, text: String, date: String?, key: String): VoiceProposal =
        api.unwrap(api.http.post("api/v2/trainer/voice") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(VoiceBody(clientId, text, date))
        })
}
