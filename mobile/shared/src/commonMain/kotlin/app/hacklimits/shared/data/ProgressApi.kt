package app.hacklimits.shared.data

import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class Records(val records: List<Record> = emptyList(), val badges: List<Badge> = emptyList()) {
    @Serializable data class Record(val exercise: String, val best: String, val metric: String = "reps", val updated: String? = null)
    @Serializable data class Badge(val label: String, val earned: Boolean)
}

@Serializable data class HistoryItem(val date: String, val title: String, val n: Int, val durationSec: Int? = null)

@Serializable data class PhotoRef(val id: Long, val takenAt: String)
@Serializable private data class ProfilePhotos(val photos: List<PhotoRef> = emptyList())

class ProgressApi(private val api: ApiClient) {
    suspend fun records(): Records = api.unwrap(api.http.get("api/v2/records") { api.authorize(this) })

    suspend fun history(): List<HistoryItem> = api.unwrap(api.http.get("api/v2/workout/history") { api.authorize(this) })

    suspend fun photos(): List<PhotoRef> = api.unwrap<ProfilePhotos>(api.http.get("api/v2/profile") { api.authorize(this) }).photos

    /** Where the app loads a progress photo from (sent with the bearer session). */
    fun photoUrl(id: Long): String = api.url("api/v2/photo?id=$id")

    /** Logs today's body weight through the same parser the bot uses ("weight 82.5"). */
    suspend fun logWeight(kg: Double, idempotencyKey: String) {
        api.unwrap<JsonElement>(api.http.post("api/v2/log") {
            api.authorize(this)
            header("Idempotency-Key", idempotencyKey)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("kind", "measure"); put("text", "weight $kg") })
        })
    }

    /** /api/v2/photo answers without the { data } envelope, so success is any 2xx. */
    suspend fun uploadPhoto(bytes: ByteArray, mimeType: String) {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/photo",
            formData = formData {
                append("photo", bytes, Headers.build {
                    append(HttpHeaders.ContentType, mimeType)
                    append(HttpHeaders.ContentDisposition, "filename=\"progress.jpg\"")
                })
            },
        ) { api.authorize(this) }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }
}
