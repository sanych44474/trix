package app.hacklimits.shared.trainingextras

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
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrainingExtrasApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun extras(handler: MockRequestHandler): TrainingExtrasApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return TrainingExtrasApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun cardioTemplatesDecodeWithTheZoneRangesTheServerSends() = runTest {
        val api = extras { request ->
            assertEquals("/api/v2/cardio", request.url.encodedPath)
            respond(
                """{"data":{"quick":[{"key":"row","name":"Rowing","label":"Rowing"},{"key":"other","name":"","label":"Other"}],
                "structured":{"intro":"Pick one","zoneNote":"Log it after","templates":[{"key":"liss","emoji":"x","name":"Easy","totalMin":40,
                "steps":[{"label":"steady","minutes":40,"zone":2,"reps":1,"bpm":{"lo":108,"hi":126}}]}]},"bpmLabel":"bpm"},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val cardio = api.cardio()
        assertEquals("", cardio.quick[1].name)
        assertEquals(Bpm(108, 126), cardio.structured.templates[0].steps[0].bpm)
    }

    @Test
    fun aQuickLogWithoutATimeOrDistanceIsNotSavedButIsNotAnError() = runTest {
        var key: String? = null
        val api = extras { request ->
            key = request.headers["Idempotency-Key"]
            respond("""{"data":{"ok":false,"reason":"unreadable"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertFalse(api.logCardio("run", "80x5", "k".repeat(36)))
        assertEquals("k".repeat(36), key, "a logged cardio line must carry the retry key")
    }

    @Test
    fun aComebackDecisionSendsEveryAnswerAndTheDecision() = runTest {
        var body = ""
        val api = extras { request ->
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond("""{"data":{"ok":true,"decision":"keep","planPending":false},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val answers = mapOf("feel" to "good", "goals" to "same", "weight" to "up", "changed" to "no")
        val result = api.answerComeback(answers, "keep", "k".repeat(36))
        assertEquals("keep", result.decision)
        assertFalse(result.planPending)
        assertTrue(body.contains("\"decision\":\"keep\""), body)
        assertTrue(body.contains("\"weight\":\"up\""), body)
        assertTrue(body.contains("\"answers\":{"), body)
    }

    @Test
    fun aComebackRefusedBecauseNoneIsPendingReportsConflict() = runTest {
        val api = extras {
            respond("""{"error":{"code":"conflict","message":"conflict"}}""", HttpStatusCode.Conflict, json)
        }
        assertEquals("conflict", assertFailsWith<ApiException> { api.answerComeback(emptyMap(), "keep", "k".repeat(36)) }.code)
    }

    @Test
    fun theStandardsResponseWithoutABodyweightAsksForOne() = runTest {
        val api = extras {
            respond("""{"data":{"needsWeight":true,"bodyweight":null,"sex":"male","lifts":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val standards = api.standards()
        assertTrue(standards.needsWeight)
        assertTrue(standards.lifts.isEmpty())
    }
}
