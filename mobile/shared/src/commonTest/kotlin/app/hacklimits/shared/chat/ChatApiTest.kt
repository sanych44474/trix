package app.hacklimits.shared.chat

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class ChatApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun chat(handler: MockRequestHandler): ChatApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return ChatApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun threadAsksForThePeerInTheQueryAndDecodesTheMessages() = runTest {
        val api = chat { request ->
            assertEquals("/api/v2/chat", request.url.encodedPath)
            assertEquals("42", request.url.parameters["with"])
            respond(
                """{"data":{"peer":{"id":42,"name":"Ann","isTrainer":false},"messages":[{"id":1,"fromMe":true,"text":"Hi","createdAt":"2026-10-20 11:00:00","read":true},{"id":2,"fromMe":false,"text":"Hello","createdAt":"2026-10-20 11:05:00"}]},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val thread = api.thread(42)
        assertEquals("Ann", thread.peer.name)
        assertEquals(listOf(true, false), thread.messages.map { it.fromMe })
        assertEquals(true, thread.messages[0].read)
    }

    @Test
    fun aClientsOwnTrainerThreadSendsNoPeerParameter() = runTest {
        val api = chat { request ->
            assertNull(request.url.parameters["with"])
            respond("""{"data":{"peer":{"id":7,"name":"Coach","isTrainer":true},"messages":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals(true, api.thread(null).peer.isTrainer)
    }

    @Test
    fun sendPostsTheTextWithThePeerAndAKey() = runTest {
        val api = chat { request ->
            assertEquals("/api/v2/chat", request.url.encodedPath)
            assertEquals("k".repeat(36), request.headers["Idempotency-Key"])
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertContains(body, "\"text\":\"Hi there\"")
            assertContains(body, "\"with\":42")
            respond("""{"data":{"ok":true,"id":9},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.send("Hi there", 42, "k".repeat(36))
    }

    @Test
    fun aClientSendOmitsTheWithField() = runTest {
        val api = chat { request ->
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertFalse(body.contains("with"), "a client's message goes to their own trainer")
            respond("""{"data":{"ok":true,"id":9},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.send("Hi", null, "k".repeat(36))
    }

    @Test
    fun draftReturnsTheSuggestedReplyText() = runTest {
        val api = chat { request ->
            assertEquals("/api/v2/chat/draft", request.url.encodedPath)
            respond("""{"data":{"draft":"Try a deload this week."},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals("Try a deload this week.", api.draft(42))
    }

    @Test
    fun unreadMapsTheSenderIdsToCounts() = runTest {
        val api = chat { respond("""{"data":{"bySender":{"42":3,"7":1}},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        assertEquals(mapOf(42L to 3, 7L to 1), api.unread())
    }

    @Test
    fun theStampIsTheMiniAppSliceAndSurvivesShortInput() {
        assertEquals("10-20 11:00", chatStamp("2026-10-20T11:00:00.000Z"))
        assertEquals("10-20 11:00", chatStamp("2026-10-20 11:00:00"))
        assertEquals("", chatStamp("abc"))
    }
}
