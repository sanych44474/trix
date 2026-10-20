package app.hacklimits.shared.integrations

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** GET /api/v2/strava. [available] is false when the server has no Strava app configured. */
@Serializable
data class StravaStatus(
    val available: Boolean,
    val connected: Boolean,
    val lastSyncAt: String? = null,
    val lastError: String? = null,
)

@Serializable
data class StravaSync(val imported: Int, val days: Int)

@Serializable
private data class StravaConnect(val url: String)

/** Strava cardio-import endpoints (src/webapp/stravaApi.ts, contract in packages/contracts/openapi.yaml). */
class StravaApi(private val api: ApiClient) {
    suspend fun status(): StravaStatus = api.unwrap(api.http.get("api/v2/strava") { api.authorize(this) })

    /** The Strava authorize page. Open it in the external browser; the server finishes the link on callback. */
    suspend fun connectUrl(): String =
        api.unwrap<StravaConnect>(api.http.post("api/v2/strava/connect") { api.authorize(this) }).url

    /** 404 when nothing is connected yet, 503 when Strava is down. */
    suspend fun sync(): StravaSync = api.unwrap(api.http.post("api/v2/strava/sync") { api.authorize(this) })

    suspend fun disconnect() {
        api.unwrap<JsonElement>(api.http.delete("api/v2/strava") { api.authorize(this) })
    }
}
