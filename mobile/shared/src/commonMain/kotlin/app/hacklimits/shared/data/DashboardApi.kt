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
    val weight: Weight = Weight(),
) {
    @Serializable data class Weight(val points: List<Point> = emptyList(), val goal: Double? = null) {
        @Serializable data class Point(val date: String, val kg: Double)
    }
    @Serializable data class Viewer(val id: Long, val role: String, val onboarded: Boolean, val planPending: Boolean = false)
    @Serializable data class Calendar(val days: List<Day> = emptyList(), val split: List<Split> = emptyList()) {
        /** A planned training weekday (1 = Monday). */
        @Serializable data class Split(val weekday: Int, val group: String = "", val n: Int = 0)
        @Serializable data class Day(val date: String, @SerialName("s") val status: String)
    }

    /** Whether the plan has a workout today (today's ISO weekday is in the split). */
    val trainingToday: Boolean
        get() = runCatching { kotlinx.datetime.LocalDate.parse(today).dayOfWeek.ordinal + 1 }.getOrNull()
            ?.let { wd -> calendar.split.any { it.weekday == wd } } ?: true
}

class DashboardApi(private val api: ApiClient) {
    suspend fun load(): Dashboard = api.unwrap(api.http.get("api/v2/dashboard") { api.authorize(this) })
}
