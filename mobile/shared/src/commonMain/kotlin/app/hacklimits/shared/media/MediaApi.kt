package app.hacklimits.shared.media

import app.hacklimits.shared.data.ApiClient
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

internal class MediaApi(private val api: ApiClient) {
    /** Nothing is logged here; the person confirms the items first. */
    suspend fun estimateMealPhoto(jpeg: ByteArray, mimeType: String): List<LoggedFood> {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/media/meal-photo",
            formData = formData {
                append("photo", jpeg, Headers.build {
                    append(HttpHeaders.ContentType, mimeType)
                    append(HttpHeaders.ContentDisposition, "filename=\"meal.jpg\"")
                })
            },
        ) { api.authorize(this) }
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
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(FoodLogBody("food", text.take(500)))
        }).ok
}
