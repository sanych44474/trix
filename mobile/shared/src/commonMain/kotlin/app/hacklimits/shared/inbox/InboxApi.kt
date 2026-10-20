package app.hacklimits.shared.inbox

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * One notification. [kind] stays a string so a kind this build does not know yet decodes and is
 * simply not shown (see inboxLine). [params] carries the per-kind fields the copy needs.
 */
@Serializable
data class InboxItem(
    val id: Long,
    val kind: String,
    val params: JsonObject = JsonObject(emptyMap()),
    val createdAt: String,
    val read: Boolean = true,
)

/** GET /api/v2/inbox: the newest items and how many are unread (adapters/d1/v2Inbox.ts listInbox). */
@Serializable
data class InboxFeed(val items: List<InboxItem> = emptyList(), val unread: Int = 0)

class InboxApi(private val api: ApiClient) {
    suspend fun feed(): InboxFeed = api.unwrap(api.http.get("api/v2/inbox") { api.authorize(this) })

    /** Marks everything read. The Mini App calls it once the feed has loaded. */
    suspend fun markRead() {
        api.unwrap<JsonObject>(api.http.post("api/v2/inbox/read") { api.authorize(this) })
    }
}
