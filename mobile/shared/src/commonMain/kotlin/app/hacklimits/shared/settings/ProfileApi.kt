package app.hacklimits.shared.settings

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** GET/POST /api/v2/profile (src/webapp/profileApi.ts). The POST is a partial update: only the keys
 * sent change, and null clears goalWeight, waterGoalMl and stepsGoal. */
@Serializable
data class ProfileResponse(
    val referralLink: String = "",
    val referredCount: Int = 0,
    val profile: ProfileFields = ProfileFields(),
    val options: ProfileOptions = ProfileOptions(),
    val weekdays: List<WeekdayOption> = emptyList(),
) {
    @Serializable data class ProfileFields(
        val name: String = "",
        val goal: String = "",
        val level: String = "",
        val goalWeight: Double? = null,
        val waterGoalMl: Int? = null,
        val stepsGoal: Int? = null,
        val trainingWeekdays: List<Int> = emptyList(),
        /** Local hour of the daily reminder (the bot's default is 9). */
        val reminderHour: Int = 9,
        /** Only clients have trainer-sharing consent; null for everyone else. */
        val share: Consent? = null,
    )
    @Serializable data class Consent(val body: Boolean = false, val health: Boolean = false)
    @Serializable data class ProfileOptions(val goal: List<Option> = emptyList(), val level: List<Option> = emptyList())
    /** A localized choice (value is the server's canonical string). */
    @Serializable data class Option(val value: String, val label: String)
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    @Serializable data class WeekdayOption(val value: Int, val label: String)
}

/** What the More screen sends back. Fields left null are cleared on the server. */
data class ProfileEdit(
    val name: String,
    val goal: String,
    val level: String,
    val goalWeight: Double?,
    val waterGoalMl: Int?,
    val stepsGoal: Int?,
    val trainingWeekdays: List<Int>,
    val share: ProfileResponse.Consent?,
)

class ProfileApi(private val api: ApiClient) {
    suspend fun load(): ProfileResponse = api.unwrap(api.http.get("api/v2/profile") { api.authorize(this) })

    suspend fun save(edit: ProfileEdit) {
        val body = buildJsonObject {
            put("name", edit.name)
            put("goal", edit.goal)
            put("level", edit.level)
            put("goalWeight", edit.goalWeight?.let { JsonPrimitive(it) } ?: JsonNull)
            put("waterGoalMl", edit.waterGoalMl?.let { JsonPrimitive(it) } ?: JsonNull)
            put("stepsGoal", edit.stepsGoal?.let { JsonPrimitive(it) } ?: JsonNull)
            put("trainingWeekdays", JsonArray(edit.trainingWeekdays.map { JsonPrimitive(it) }))
            edit.share?.let { s ->
                put("share", buildJsonObject { put("body", s.body); put("health", s.health) })
            }
        }
        postProfile(body)
    }

    private suspend fun postProfile(body: JsonObject) {
        api.unwrap<JsonObject>(api.http.post("api/v2/profile") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(body)
        })
    }
}
