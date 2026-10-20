package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** GET/POST /api/v2/settings (src/webapp/settingsApi.ts state()). Reminder labels come translated
 * from the server in the account's language. */
@Serializable
data class SettingsState(
    val onboarded: Boolean = false,
    val reminders: List<Reminder> = emptyList(),
    val vacationUntil: String? = null,
    val lang: String = "uk",
    val role: String = "solo",
) {
    @Serializable data class Reminder(val key: String, val label: String, val on: Boolean)
}

@Serializable private data class SettingsResult(val state: SettingsState? = null)

class SettingsApi(private val api: ApiClient) {
    suspend fun load(): SettingsState = api.unwrap(api.http.get("api/v2/settings") { api.authorize(this) })

    suspend fun toggleReminder(key: String): SettingsState? = act(buildJsonObject { put("action", "remToggle"); put("key", key) })
    suspend fun setLanguage(lang: String): SettingsState? = act(buildJsonObject { put("action", "lang"); put("lang", lang) })
    suspend fun vacation(days: Int?): SettingsState? = act(buildJsonObject {
        put("action", "vacation")
        if (days == null) put("off", true) else put("days", days)
    })

    /** The data export as a file (the server returns it directly for the native app). */
    suspend fun export(json: Boolean): ByteArray {
        val response = api.http.post("api/v2/settings") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("action", if (json) "export_json" else "export"); put("delivery", "download") })
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
        return response.bodyAsBytes()
    }

    /** Permanent. The caller must have asked the person to confirm. */
    suspend fun deleteAccount() {
        api.unwrap<JsonObject>(api.http.post("api/v2/settings") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("action", "deleteAccount"); put("confirm", JsonPrimitive(true)) })
        })
    }

    private suspend fun act(body: JsonObject): SettingsState? =
        api.unwrap<SettingsResult>(api.http.post("api/v2/settings") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(body)
        }).state
}
