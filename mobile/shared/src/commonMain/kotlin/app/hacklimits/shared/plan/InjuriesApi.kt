package app.hacklimits.shared.plan

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** An option the server offers (labels come translated from the server). */
@Serializable data class InjuryOption(val value: String, val label: String)

/** An injury still being tracked. [area] and [severity] are already the server's translated labels. */
@Serializable data class ActiveInjury(val area: String, val severity: String = "", val since: String = "", val lastScore: Double? = null)

/** GET /api/v2/injuries: the active injuries and the choices for reporting a new one. */
@Serializable data class InjuryPayload(
    val injuries: List<ActiveInjury> = emptyList(),
    val areas: List<InjuryOption> = emptyList(),
    val severities: List<InjuryOption> = emptyList(),
)

@Serializable private data class InjuryReport(val area: String, val severity: String)

class InjuriesApi(private val api: ApiClient) {
    suspend fun load(): InjuryPayload = api.unwrap(api.http.get("api/v2/injuries") { api.authorize(this) })

    suspend fun report(area: String, severity: String) {
        api.unwrap<JsonElement>(api.http.post("api/v2/injuries") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(InjuryReport(area, severity))
        })
    }
}
