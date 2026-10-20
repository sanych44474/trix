package app.hacklimits.shared.owner

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One row of the owner roster (openapi `OwnerUsers.rows`, src/bot/owner.ts OwnerUserRow). */
@Serializable
data class OwnerUser(
    val id: Long,
    val name: String = "",
    val nick: String = "",
    val trainer: String = "",
    /** banned (blocked by the owner), blocked (blocked the bot), onboarding, active, draft or none. */
    val status: String = "none",
    val onb: String = "",
    val w: Int = 0,
    val c: Int = 0,
    val n: Int = 0,
    val s: Int = 0,
    val last: String = "",
    val total: Int = 0,
    /** ISO time of the last interaction; null when never seen. */
    val lastSeen: String? = null,
)

@Serializable data class OwnerUsers(val rows: List<OwnerUser> = emptyList())

/** One feedback row. `category` is bug, idea, complaint, praise, rating or other; `status` is new, done or wontfix. */
@Serializable
data class FeedbackRow(
    val id: Long,
    val userId: Long,
    val username: String? = null,
    val name: String? = null,
    val text: String,
    val date: String,
    val category: String,
    val status: String,
)

@Serializable data class FeedbackCounts(val new: Int = 0, val done: Int = 0, val wontfix: Int = 0)
@Serializable data class FeedbackPage(val rows: List<FeedbackRow> = emptyList(), val counts: FeedbackCounts = FeedbackCounts())

@Serializable data class ReleaseInfo(val version: String = "", val pending: Int = 0, val queue: Boolean = false)

@Serializable
data class ReleaseSent(
    val version: String = "",
    val sent: Int = 0,
    val failed: Int = 0,
    val remaining: Int = 0,
    /** Chats queued for delivery; only in queue mode. */
    val queued: Int? = null,
)

@Serializable
data class AnnounceResult(
    val sent: Int = 0,
    val failed: Int = 0,
    val total: Int = 0,
    val remaining: Int = 0,
    /** Where the next batch starts; null when this was the last one. */
    val next: Long? = null,
    val queued: Int? = null,
)

@Serializable private data class ReportBody(val html: String = "")
@Serializable private data class SentCount(val sent: Int = 0)
@Serializable private data class ImageResult(val ok: Boolean = false)
@Serializable private data class FeedbackSaved(val ok: Boolean = false, val notified: Boolean = false)

/**
 * The owner console's endpoints (src/webapp/ownerApi.ts). Every route answers 404 to anyone who is
 * not the owner, so [isOwner] is the cheap check that decides whether the entry is shown at all.
 */
class OwnerApi(private val api: ApiClient) {
    /** True only when the signed-in person is the owner. Any failure counts as not the owner. */
    suspend fun isOwner(): Boolean = runCatching {
        api.http.get("api/v2/owner/release") { api.authorize(this) }.status == HttpStatusCode.OK
    }.getOrDefault(false)

    /** One /ownerreport section as Telegram-style HTML (see OwnerLogic.plainReport). */
    suspend fun report(section: String): String = api.unwrap<ReportBody>(
        api.http.get("api/v2/owner/report") {
            api.authorize(this)
            parameter("section", section)
        },
    ).html

    suspend fun users(): List<OwnerUser> = api.unwrap<OwnerUsers>(
        api.http.get("api/v2/owner/users") { api.authorize(this) },
    ).rows

    /** block, unblock, delete or nudge (an unfinished onboarding). */
    suspend fun moderate(userId: Long, action: String, key: String) {
        post<JsonElement>("api/v2/owner/user/$userId/$action", key)
    }

    suspend fun feedback(status: String): FeedbackPage = api.unwrap(
        api.http.get("api/v2/owner/feedback") {
            api.authorize(this)
            parameter("status", status)
        },
    )

    /** Sets a status and/or category. `notify` tells the author it shipped; only sent with status done. */
    suspend fun updateFeedback(id: Long, status: String?, category: String?, notify: Boolean, key: String): Boolean {
        val body = buildJsonObject {
            status?.let { put("status", it) }
            category?.let { put("category", it) }
            if (status == "done") put("notify", notify)
        }
        return post<FeedbackSaved>("api/v2/owner/feedback/$id", key, body).notified
    }

    suspend fun release(): ReleaseInfo = api.unwrap(api.http.get("api/v2/owner/release") { api.authorize(this) })

    suspend fun sendRelease(key: String): ReleaseSent = post("api/v2/owner/release/send", key)

    /** Announcement to every onboarded user. `after` continues the previous batch when there is no queue. */
    suspend fun announce(text: String, after: Long?, key: String): AnnounceResult {
        val body = buildJsonObject {
            put("text", text)
            after?.let { put("after", it) }
        }
        return post("api/v2/owner/announce", key, body)
    }

    suspend fun askInactive(key: String): Int = post<SentCount>("api/v2/owner/ask-inactive", key).sent

    /** Generates a picture and sends it to the owner's chat. A 429 (rate_limited) means today's budget is spent. */
    suspend fun promoImage(prompt: String, key: String): Boolean =
        post<ImageResult>("api/v2/owner/image", key, buildJsonObject { put("prompt", prompt) }, ai = true).ok

    private suspend inline fun <reified T> post(
        path: String,
        key: String,
        body: JsonObject = JsonObject(emptyMap()),
        ai: Boolean = false,
    ): T {
        val response = api.http.post(path) {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(body)
            if (ai) aiTimeout()
        }
        return api.unwrap(response)
    }
}

/** Image generation runs on the model, which can take well past the default 30 s. */
private fun HttpRequestBuilder.aiTimeout() = timeout {
    requestTimeoutMillis = 120_000L
    socketTimeoutMillis = 120_000L
}
