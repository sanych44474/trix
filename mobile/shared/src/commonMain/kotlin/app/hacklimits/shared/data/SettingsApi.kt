package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
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
    /** Only for female profiles; null hides the cycle card. */
    val cycle: Cycle? = null,
    val compete: Compete = Compete(),
) {
    @Serializable data class Reminder(val key: String, val label: String, val on: Boolean)
    @Serializable data class Cycle(val on: Boolean = false, val lastStart: String? = null, val len: Int = 28)
    @Serializable data class Compete(val on: Boolean = false, val alias: String = "")
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

    /** Null fields are left out, so the server keeps what it has. */
    suspend fun cycle(on: Boolean? = null, lastStart: String? = null, len: Int? = null): SettingsState? = act(buildJsonObject {
        put("action", "cycle")
        on?.let { put("on", it) }
        lastStart?.let { put("lastStart", it) }
        len?.let { put("len", it) }
    })

    suspend fun compete(on: Boolean? = null, alias: String? = null): SettingsState? = act(buildJsonObject {
        put("action", "compete")
        on?.let { put("on", it) }
        alias?.let { put("alias", it) }
    })

    suspend fun feedback(text: String): SettingsState? = act(buildJsonObject { put("action", "feedback"); put("text", text) })

    /** Disconnects from the trainer; only a client can do it. */
    suspend fun leaveTrainer(): SettingsState? = act(buildJsonObject { put("action", "leaveTrainer") })

    /** The data export as a file bytes, or null when the account has nothing to export. The server
     * answers `{ok:false}` with no attachment in that case. */
    suspend fun export(json: Boolean): ByteArray? {
        val response = api.http.post("api/v2/settings") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("action", if (json) "export_json" else "export"); put("delivery", "download") })
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
        val attachment = response.headers[HttpHeaders.ContentDisposition]?.startsWith("attachment") == true
        return if (attachment) response.bodyAsBytes() else null
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
