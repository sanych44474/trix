package app.hacklimits.shared.daily

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** GET /api/v2/wellbeing: the 90-day averages (1-5) and the second-half minus first-half trend. */
@Serializable
data class WellbeingPayload(val count: Int = 0, val averages: WellbeingMeans? = null, val trend: WellbeingMeans? = null)

@Serializable
data class WellbeingMeans(val energy: Double = 0.0, val sleep: Double = 0.0, val stress: Double = 0.0)

/** GET /api/v2/survey: today's still-unlogged evening items, labelled by the server in the user's language. */
@Serializable
data class SurveyPayload(val date: String = "", val items: List<SurveyItem> = emptyList())

@Serializable
data class SurveyItem(val key: String, val label: String)

/** POST /api/v2/plan action=difficulty: how many exercises of the day changed (0 = no variant found). */
@Serializable
data class DifficultyResult(val ok: Boolean = false, val swapped: Int = 0)

class DailyApi(private val api: ApiClient) {
    suspend fun wellbeing(): WellbeingPayload = api.unwrap(api.http.get("api/v2/wellbeing") { api.authorize(this) })

    suspend fun survey(): SurveyPayload = api.unwrap(api.http.get("api/v2/survey") { api.authorize(this) })

    /** Saves the daily reminder hour (0-23, local time) through the profile endpoint's patch. */
    suspend fun setReminderHour(hour: Int, key: String) {
        api.unwrap<JsonObject>(api.http.post("api/v2/profile") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("reminderHour", hour) })
        })
    }

    /** One notch harder ([up] = true) or easier on a plan day; the same swap the bot's buttons run. */
    suspend fun stepDifficulty(weekday: Int, up: Boolean, key: String): DifficultyResult =
        api.unwrap(api.http.post("api/v2/plan") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("action", "difficulty")
                put("weekday", weekday)
                put("dir", if (up) "up" else "down")
            })
        })
}
