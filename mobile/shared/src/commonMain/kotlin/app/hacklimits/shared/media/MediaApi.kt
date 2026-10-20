package app.hacklimits.shared.media

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.aiTimeout
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlin.math.roundToInt

/** One food as the AI estimates it and as the server logs it (openapi `LoggedFoodItem`). */
@Serializable
data class LoggedFood(
    val desc: String,
    val kcal: Double,
    val protein: Double,
    val fats: Double,
    val carbs: Double,
    val grams: Double? = null,
    val query: String? = null,
)

@Serializable private data class MealEstimate(val items: List<LoggedFood> = emptyList())
@Serializable private class AddItemsBody(val action: String, val items: List<LoggedFood>)
@Serializable private class FoodLogBody(val kind: String, val text: String)
// The server answers 200 with ok=false when the text could not be read, so success is not implied.
@Serializable private data class FoodLogResult(val ok: Boolean = false)
@Serializable private data class Transcript(val text: String = "")

/** Form check verdict. `ok = false` carries a `reason` (too_big, too_long, limit, failed). */
@Serializable
data class FormCheckResult(val ok: Boolean = false, val text: String? = null, val reason: String? = null, val limit: Int? = null)

/** CSV import verdict. `ok = false` carries a `reason` (too_big, wrong_format, failed). */
@Serializable
data class CsvImportResult(
    val ok: Boolean = false,
    val reason: String? = null,
    val imported: Int = 0,
    val skipped: Int = 0,
    val capped: Boolean = false,
    val cap: Int = 200,
)



private fun partHeaders(mimeType: String, fileName: String) = Headers.build {
    append(HttpHeaders.ContentType, mimeType)
    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
}

internal class MediaApi(private val api: ApiClient) {
    /** Nothing is logged here; the person confirms the items first. The caption is an optional hint for the AI. */
    suspend fun estimateMealPhoto(jpeg: ByteArray, mimeType: String, caption: String? = null): List<LoggedFood> {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/media/meal-photo",
            formData = formData {
                append("photo", jpeg, partHeaders(mimeType, "meal.jpg"))
                caption?.trim()?.takeIf { it.isNotEmpty() }?.let { append("caption", it.take(200)) }
            },
        ) {
            api.authorize(this)
            aiTimeout()
        }
        return api.unwrap<MealEstimate>(response).items
    }

    /** The key makes a retry after a dropped connection log the meal once. */
    suspend fun addItems(items: List<LoggedFood>, key: String) {
        api.unwrap<JsonElement>(api.http.post("api/v2/nutrition") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(AddItemsBody("add_items", items))
        })
    }

    /** False when the AI could not read the description; nothing was logged then. */
    suspend fun logFoodText(text: String, key: String): Boolean =
        api.unwrap<FoodLogResult>(api.http.post("api/v2/log") {
            api.authorize(this)
            aiTimeout()
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(FoodLogBody("food", text.take(500)))
        }).ok

    /** A short training clip for technique remarks. The server re-checks the size and length. */
    suspend fun formCheck(video: ByteArray, mimeType: String, caption: String?, seconds: Double?): FormCheckResult {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/media/form-check",
            formData = formData {
                append("video", video, partHeaders(mimeType, "set.mp4"))
                caption?.trim()?.takeIf { it.isNotEmpty() }?.let { append("caption", it.take(120)) }
                seconds?.let { append("seconds", it.roundToInt().toString()) }
            },
        ) {
            api.authorize(this)
            aiTimeout()
        }
        return api.unwrap(response)
    }

    /** Strong or Hevy CSV export. Days that already have a log are skipped by the server. */
    suspend fun importCsv(csv: ByteArray): CsvImportResult {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/media/import-csv",
            formData = formData { append("file", csv, partHeaders("text/csv", "export.csv")) },
        ) { api.authorize(this) }
        return api.unwrap(response)
    }

    /** Speech to text for a clip recorded by the platform recorder. */
    suspend fun transcribe(audio: ByteArray, mimeType: String, fileExtension: String): String {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/media/transcribe",
            formData = formData { append("audio", audio, partHeaders(mimeType, "voice.$fileExtension")) },
        ) {
            api.authorize(this)
            aiTimeout()
        }
        return api.unwrap<Transcript>(response).text
    }
}
