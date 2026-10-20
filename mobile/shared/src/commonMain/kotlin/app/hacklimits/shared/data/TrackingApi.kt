package app.hacklimits.shared.data

import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One-tap daily logs (POST /api/v2/log, src/webapp/quickLogApi.ts). Each call carries its own
 * Idempotency-Key so a retried tap can't count twice. */
class TrackingApi(private val api: ApiClient) {
    suspend fun water(ml: Int, key: String) = log(buildJsonObject { put("kind", "water"); put("ml", ml) }, key)
    suspend fun steps(steps: Int, key: String) = log(buildJsonObject { put("kind", "steps"); put("steps", steps) }, key)
    suspend fun checkin(energy: Int, sleep: Int, stress: Int, key: String) =
        log(buildJsonObject { put("kind", "checkin"); put("energy", energy); put("sleep", sleep); put("stress", stress) }, key)

    private suspend fun log(body: JsonObject, key: String) {
        api.unwrap<JsonElement>(api.http.post("api/v2/log") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(body)
        })
    }
}
