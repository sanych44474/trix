package app.hacklimits.shared.account

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The find-a-trainer directory: GET /api/v2/trainers (src/webapp/extrasApi.ts). */
@Serializable
data class TrainerDirectory(
    val role: String = "solo",
    val trainers: List<DirectoryTrainer> = emptyList(),
    /** The caller's own pending request, if there is one. */
    val pending: PendingRequest? = null,
)

@Serializable
data class DirectoryTrainer(
    val id: Long,
    val name: String = "",
    val specialization: String = "",
    val city: String = "",
    val experienceYears: Int? = null,
    val priceOnline: Int? = null,
    val currency: String? = null,
    val bio: String = "",
)

@Serializable data class PendingRequest(val trainerId: Long, val name: String = "")

/** GET /api/v2/trainer/profile: the caller's own trainer row, or null when they never applied. */
@Serializable
data class TrainerProfileResponse(val role: String = "solo", val trainer: TrainerProfile? = null)

@Serializable
data class TrainerProfile(
    /** "pending", "approved" or "rejected". */
    val status: String = "pending",
    val name: String = "",
    val bio: String = "",
    val specialization: String = "",
    val approach: String = "",
    val experienceYears: Int? = null,
    val priceOnline: Int? = null,
    val city: String = "",
    val contact: String = "",
    val accepting: Boolean = false,
    val clients: Int = 0,
)

/** A trainer's inbox entry: GET /api/v2/requests (trainers only). */
@Serializable data class ClientRequest(val id: Long, val clientId: Long, val name: String = "", val note: String = "")
@Serializable private data class ClientRequests(val requests: List<ClientRequest> = emptyList())

class TrainerApi(private val api: ApiClient) {
    suspend fun directory(): TrainerDirectory = api.unwrap(api.http.get("api/v2/trainers") { api.authorize(this) })

    /** Sends a request to an approved trainer. */
    suspend fun requestTrainer(trainerId: Long) {
        api.unwrap<JsonObject>(api.http.post("api/v2/trainers") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("trainerId", trainerId) })
        })
    }

    suspend fun cancelRequest() {
        api.unwrap<JsonObject>(api.http.delete("api/v2/trainers") { api.authorize(this) })
    }

    suspend fun trainerProfile(): TrainerProfileResponse = api.unwrap(api.http.get("api/v2/trainer/profile") { api.authorize(this) })

    /** Creates the trainer application when the caller has no row yet (needs a name), or edits it. */
    suspend fun saveTrainerProfile(name: String, specialization: String, city: String, contact: String, bio: String) {
        api.unwrap<JsonObject>(api.http.post("api/v2/trainer/profile") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", name)
                put("specialization", specialization)
                put("city", city)
                put("contact", contact)
                put("bio", bio)
            })
        })
    }

    suspend fun requests(): List<ClientRequest> = api.unwrap<ClientRequests>(api.http.get("api/v2/requests") { api.authorize(this) }).requests

    /** Accepts or declines a pending request (trainer inbox). */
    suspend fun respond(requestId: Long, accept: Boolean) {
        api.unwrap<JsonObject>(api.http.post("api/v2/requests") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("id", requestId); put("action", if (accept) "accept" else "decline") })
        })
    }
}
