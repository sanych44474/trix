package app.hacklimits.shared.coach

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
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
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoachApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): CoachApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return CoachApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun askPostsQuestionWithHistoryAndIdempotencyKeyAndDecodesTheAnswer() = runTest {
        val coach = api { request ->
            assertEquals("/api/v2/coach/ask", request.url.encodedPath)
            assertEquals("k".repeat(16), request.headers["Idempotency-Key"])
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertContains(body, "\"question\":\"Rest tomorrow?\"")
            assertContains(body, "\"role\":\"coach\"")
            respond(
                """{"data":{"answer":"Yes, take an easy day.","actions":[]},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val history = listOf(CoachHistoryTurn("user", "Hi"), CoachHistoryTurn("coach", "Hello"))
        val answer = coach.ask("Rest tomorrow?", history, "k".repeat(16))
        assertEquals("Yes, take an easy day.", answer.answer)
        assertFalse(answer.routed)
    }

    @Test
    fun askForAClientWithATrainerReturnsRoutedWithoutAnswer() = runTest {
        val coach = api { respond("""{"data":{"routed":true},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        val answer = coach.ask("Can I skip leg day?", emptyList(), "k".repeat(16))
        assertTrue(answer.routed)
        assertNull(answer.answer)
    }

    @Test
    fun askSurfacesTheServerErrorCode() = runTest {
        val coach = api {
            respond(
                """{"error":{"code":"rate_limited","message":"Too many requests, slow down"}}""",
                HttpStatusCode.TooManyRequests,
                json,
            )
        }
        val e = assertFailsWith<ApiException> { coach.ask("Hi", emptyList(), "k".repeat(16)) }
        assertEquals("rate_limited", e.code)
        assertEquals(429, e.status)
    }

    @Test
    fun threadDecodesRoutedQuestionsAndTrainerReplies() = runTest {
        val coach = api {
            respond(
                """{"data":{"trainer":{"name":"Anna"},"questions":[{"id":3,"text":"Knee hurts","status":"answered","createdAt":"2026-10-20T10:00:00.000Z"}],"messages":[{"fromMe":false,"text":"Rest it.","createdAt":"2026-10-20 11:00:00"}]},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val thread = coach.thread()
        assertEquals("Anna", thread.trainer?.name)
        assertEquals("Knee hurts", thread.questions.single().text)
        assertEquals("Rest it.", thread.messages.single().text)
    }

    @Test
    fun threadLinesAreInTimeOrderWithTrainerRepliesAsTrainer() {
        val lines = threadLines(
            CoachThread(
                trainer = CoachTrainer("Anna"),
                questions = listOf(CoachQuestion(3, "Knee hurts &amp; swells", "answered", "2026-10-20T10:00:00.000Z")),
                messages = listOf(
                    CoachMessage(fromMe = false, text = "<b>Rest</b> it.", createdAt = "2026-10-20 11:00:00"),
                    CoachMessage(fromMe = true, text = "Thanks", createdAt = "2026-10-20 11:05:00"),
                ),
            ),
        )
        assertEquals(listOf(CoachRole.User, CoachRole.Trainer, CoachRole.User), lines.map { it.role })
        assertEquals("Knee hurts & swells", lines[0].text)
        assertEquals("Rest it.", lines[1].text)
    }

    @Test
    fun plainCoachTextStripsTagsAndDecodesEntitiesOnce() {
        assertEquals("Drink water\nthen rest", plainCoachText("<p>Drink water<br>then rest</p>"))
        assertEquals("a & b <c>", plainCoachText("a &amp; b &lt;c&gt;"))
        assertEquals("&lt;not a tag&gt;", plainCoachText("&amp;lt;not a tag&amp;gt;"))
    }
}
