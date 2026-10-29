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
    fun askDecodesTheActionButtonsUnderTheAnswer() = runTest {
        val coach = api {
            respond(
                """{"data":{"answer":"Drop the squat weight.","actions":[{"label":"Squat -5 kg","kind":"weight","weekday":1,"index":0,"value":"100"},{"label":"Send to team","kind":"feedback","value":"Cannot log sets","note":"my note"}]},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val actions = coach.ask("Squat is heavy", emptyList(), "k".repeat(16)).actions
        assertEquals(listOf("weight", "feedback"), actions.map { it.kind })
        assertEquals(1, actions[0].weekday)
        assertEquals("my note", actions[1].note)
    }

    @Test
    fun feedbackPostsTheSummaryAndTheOriginalWithAKey() = runTest {
        val coach = api { request ->
            assertEquals("/api/v2/coach/feedback", request.url.encodedPath)
            assertEquals("k".repeat(16), request.headers["Idempotency-Key"])
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertContains(body, "\"summary\":\"Cannot log sets\"")
            assertContains(body, "\"original\":\"my note\"")
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        coach.feedback("Cannot log sets", "my note", "k".repeat(16))
    }

    @Test
    fun planEditPostsTheMiniAppPayloadAndLeavesOutAnEmptyValue() = runTest {
        var body = ""
        val coach = api { request ->
            assertEquals("/api/v2/plan", request.url.encodedPath)
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond("""{"data":{},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        coach.planEdit("del", weekday = 3, index = -1, value = null, key = "k".repeat(16))
        assertContains(body, "\"action\":\"del\"")
        assertContains(body, "\"weekday\":3")
        assertContains(body, "\"index\":-1")
        assertFalse(body.contains("\"value\""), "no value key when there is nothing to send")
    }

    @Test
    fun coachActionsMapToThePlanEditTheMiniAppSends() {
        assertEquals(PlanEdit("del", 2, 4, null), CoachAction("Remove", "delete", weekday = 2, index = 4).toPlanEdit())
        assertEquals(PlanEdit("swap", 1, -1, "Row"), CoachAction("Swap", "swap", weekday = 1, exercise = "Row", value = "ignored").toPlanEdit())
        assertEquals(PlanEdit("weight", 5, -1, "80"), CoachAction("Weight", "weight", weekday = 5, value = "80").toPlanEdit())
        assertNull(CoachAction("Note", "note", weekday = 1).toPlanEdit(), "kinds the app cannot apply are left out")
        assertNull(CoachAction("Sets", "sets").toPlanEdit(), "a plan edit without a weekday cannot be applied")
    }

    @Test
    fun askDecodesAnInjuryBodySignalAndKeepsTheReplyText() = runTest {
        val coach = api {
            respond(
                """{"data":{"answer":"Rest the knee.","actions":[],"bodySignal":{"kind":"injury"}},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val answer = coach.ask("My knee hurts", emptyList(), "k".repeat(16))
        assertEquals("Rest the knee.", answer.answer)
        assertEquals(BodyAlert.Injury, answer.bodySignal?.toAlert())
    }

    @Test
    fun askDecodesAnUrgentBodySignal() = runTest {
        val coach = api {
            respond("""{"data":{"answer":"Stop training.","bodySignal":{"kind":"urgent"}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals(BodyAlert.Urgent, coach.ask("Chest pain", emptyList(), "k".repeat(16)).bodySignal?.toAlert())
    }

    @Test
    fun askWithoutBodySignalLeavesItNull() = runTest {
        val coach = api { respond("""{"data":{"answer":"Sure."},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        assertNull(coach.ask("Hi", emptyList(), "k".repeat(16)).bodySignal)
    }

    @Test
    fun anUnknownBodySignalKindDecodesAndMapsToNoCard() = runTest {
        val coach = api {
            respond("""{"data":{"answer":"Ok.","bodySignal":{"kind":"sleep"}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val answer = coach.ask("Hi", emptyList(), "k".repeat(16))
        assertEquals("Ok.", answer.answer)
        assertEquals("sleep", answer.bodySignal?.kind)
        assertNull(answer.bodySignal?.toAlert(), "a kind the app does not know shows no card")
    }

    @Test
    fun plainCoachTextStripsTagsAndDecodesEntitiesOnce() {
        assertEquals("Drink water\nthen rest", plainCoachText("<p>Drink water<br>then rest</p>"))
        assertEquals("a & b <c>", plainCoachText("a &amp; b &lt;c&gt;"))
        assertEquals("&lt;not a tag&gt;", plainCoachText("&amp;lt;not a tag&amp;gt;"))
    }
}
