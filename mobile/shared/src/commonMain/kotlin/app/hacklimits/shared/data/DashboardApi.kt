package app.hacklimits.shared.data

import io.ktor.client.request.get
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The slice of GET /api/v2/dashboard the Today screen uses (packages/contracts/openapi.yaml
 * `Dashboard`); unknown fields are ignored, so the server can grow without breaking the app. */
@Serializable
data class Dashboard(
    val viewer: Viewer,
    val lang: String = "uk",
    val today: String,
    val name: String? = null,
    val calendar: Calendar = Calendar(),
) {
    @Serializable data class Viewer(val id: Long, val role: String, val onboarded: Boolean, val planPending: Boolean = false)
    @Serializable data class Calendar(val days: List<Day> = emptyList()) {
        @Serializable data class Day(val date: String, @SerialName("s") val status: String)
    }
}

class DashboardApi(private val api: ApiClient) {
    suspend fun load(): Dashboard = api.unwrap(api.http.get("api/v2/dashboard") { api.authorize(this) })
}
