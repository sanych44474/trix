package app.hacklimits.shared.daily

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DailyApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun daily(handler: MockRequestHandler): DailyApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return DailyApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun wellbeingReadsAveragesAndTrendAndAnEmptyWindowHasNone() = runTest {
        var reply = """{"data":{"count":4,"averages":{"energy":3.0,"sleep":2.5,"stress":3.5},"trend":{"energy":1.5,"sleep":-0.5,"stress":0.0}},"meta":{"version":2}}"""
        val api = daily { request ->
            assertEquals("/api/v2/wellbeing", request.url.encodedPath)
            respond(reply, HttpStatusCode.OK, json)
        }
        val full = api.wellbeing()
        assertEquals(4, full.count)
        assertEquals(3.0, full.averages?.energy)
        assertEquals(-0.5, full.trend?.sleep)

        reply = """{"data":{"count":1,"averages":null,"trend":null},"meta":{"version":2}}"""
        val thin = api.wellbeing()
        assertNull(thin.averages)
        assertNull(thin.trend)
    }

    @Test
    fun surveyListsTheServersLabelledItems() = runTest {
        val api = daily { request ->
            assertEquals("/api/v2/survey", request.url.encodedPath)
            respond("""{"data":{"date":"2026-10-21","items":[{"key":"food","label":"Food"},{"key":"steps","label":"Steps"}]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val survey = api.survey()
        assertEquals(listOf("food", "steps"), survey.items.map { it.key })
        assertEquals("Steps", survey.items[1].label)
    }

    @Test
    fun reminderHourIsSentAsAProfilePatchWithARetryKey() = runTest {
        var body = ""
        var key: String? = null
        val api = daily { request ->
            assertEquals("/api/v2/profile", request.url.encodedPath)
            body = (request.body as TextContent).text
            key = request.headers["Idempotency-Key"]
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.setReminderHour(7, "k".repeat(36))
        assertEquals("""{"reminderHour":7}""", body)
        assertEquals("k".repeat(36), key)
    }

    @Test
    fun stepDifficultySendsTheDayAndDirection() = runTest {
        var body = ""
        val api = daily { request ->
            assertEquals("/api/v2/plan", request.url.encodedPath)
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"swapped":2,"days":[],"version":"v1"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val result = api.stepDifficulty(3, up = false, key = "k".repeat(36))
        assertEquals(2, result.swapped)
        assertTrue(result.ok)
        assertEquals("""{"action":"difficulty","weekday":3,"dir":"down"}""", body)
    }
}
