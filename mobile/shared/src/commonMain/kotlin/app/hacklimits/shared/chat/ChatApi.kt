package app.hacklimits.shared.chat

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The other side of a thread. [isTrainer] is true when the peer is the viewer's own trainer (the viewer is the client). */
@Serializable
data class ChatPeer(val id: Long, val name: String = "", val isTrainer: Boolean = false)

@Serializable
data class ChatMessage(
    val id: Long,
    val fromMe: Boolean,
    val text: String,
    val createdAt: String,
    /** Only meaningful for the viewer's own messages: whether the other side has opened the thread. */
    val read: Boolean = true,
)

/** GET /api/v2/chat (src/webapp/chatApi.ts). Messages come oldest first. */
@Serializable
data class ChatThread(val peer: ChatPeer, val messages: List<ChatMessage> = emptyList())

@Serializable private data class DraftReply(val draft: String = "")
@Serializable private data class UnreadCounts(val bySender: Map<String, Int> = emptyMap())

/**
 * Trainer <-> client chat. [peerId] is the client when a trainer opens it; a client omits it and
 * reaches their own trainer. Every write carries an Idempotency-Key so a retried send lands once.
 */
class ChatApi(private val api: ApiClient) {
    suspend fun thread(peerId: Long?): ChatThread = api.unwrap(api.http.get("api/v2/chat") {
        api.authorize(this)
        peerId?.let { parameter("with", it) }
    })

    suspend fun send(text: String, peerId: Long?, key: String) {
        api.unwrap<JsonObject>(api.http.post("api/v2/chat") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("text", text)
                peerId?.let { put("with", it) }
            })
        })
    }

    /** The trainer's AI draft of the next reply. Nothing is sent; the caller only fills the input box. */
    suspend fun draft(peerId: Long): String {
        val reply: DraftReply = api.unwrap(api.http.post("api/v2/chat/draft") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("with", peerId) })
        })
        return reply.draft
    }

    /** Unread messages per sender id, for badges next to each client. */
    suspend fun unread(): Map<Long, Int> {
        val counts: UnreadCounts = api.unwrap(api.http.get("api/v2/chat/unread") { api.authorize(this) })
        return counts.bySender.mapNotNull { (id, n) -> id.toLongOrNull()?.let { it to n } }.toMap()
    }
}
