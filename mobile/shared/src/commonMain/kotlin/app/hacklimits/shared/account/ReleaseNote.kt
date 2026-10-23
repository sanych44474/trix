package app.hacklimits.shared.account

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** GET /api/v2/whatsnew: the latest release, in the account's language. [items] are the cards parsed
 * by the server; [text] is the plain text and [html] the Telegram version. */
@Serializable
data class WhatsNewNote(
    val version: String,
    val html: String = "",
    val text: String? = null,
    val items: List<ReleaseItem> = emptyList(),
)

/** One card of a release note: "icon Title" plus body. Icon and title may be empty. */
@Serializable
data class ReleaseItem(val icon: String = "", val title: String = "", val body: String = "")

class WhatsNewApi(private val api: ApiClient) {
    suspend fun latest(): WhatsNewNote = api.unwrap(api.http.get("api/v2/whatsnew") { api.authorize(this) })

    /** The person dismissed the card; the server remembers it so it does not come back on any device. */
    suspend fun markSeen(version: String) {
        api.unwrap<JsonObject>(api.http.post("api/v2/whatsnew/seen") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("version", version) })
        })
    }
}
