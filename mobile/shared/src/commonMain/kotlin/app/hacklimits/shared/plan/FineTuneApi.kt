package app.hacklimits.shared.plan

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Saves one profile answer for the fine-tune card (POST /api/v2/profile with `{field: value}`). */
class FineTuneApi(private val api: ApiClient) {
    /** True when the server stored the answer; the card keeps the question when it did not. */
    suspend fun save(field: String, value: JsonPrimitive): Boolean = runCatching {
        api.unwrap<JsonElement>(api.http.post("api/v2/profile") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(JsonObject(mapOf(field to value)))
        })
    }.isSuccess
}
