package app.hacklimits.shared.progress

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.TrainingSignalsApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrainingSignalsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(body: String, status: HttpStatusCode = HttpStatusCode.OK): TrainingSignalsApi {
        val client = ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(MockEngine { request ->
            assertEquals("/api/v2/training-signals", request.url.encodedPath)
            respond(body, status, json)
        }))
        return TrainingSignalsApi(client)
    }

    @Test
    fun fullPayloadDecodesLiftsAndDeloadHint() = runTest {
        val signals = api(
            """{"data":{"exercises":[{"name":"Bench Press","status":"stalled","confidence":0.82},{"name":"Squat","status":"regressing","confidence":0.7}],"deload":{"probability":0.74,"suggested":true},"computedAt":"2026-10-29T06:00:00.000Z"},"meta":{"version":2}}""",
        ).load()
        assertEquals(listOf("Bench Press", "Squat"), signals.exercises.map { it.name })
        assertEquals(listOf("stalled", "regressing"), signals.exercises.map { it.status })
        assertEquals(0.82, signals.exercises[0].confidence)
        assertTrue(signals.deload!!.suggested)
        assertEquals(0.74, signals.deload!!.probability)
        assertEquals("2026-10-29T06:00:00.000Z", signals.computedAt)
    }

    @Test
    fun nullDeloadDecodesAsNull() = runTest {
        val signals = api("""{"data":{"exercises":[],"deload":null,"computedAt":"2026-10-29T06:00:00.000Z"},"meta":{"version":2}}""").load()
        assertNull(signals.deload)
        assertTrue(signals.exercises.isEmpty())
    }

    @Test
    fun unknownFieldsAreIgnored() = runTest {
        val signals = api(
            """{"data":{"exercises":[{"name":"Row","status":"progressing","confidence":0.9,"trend":"up"}],"deload":{"probability":0.1,"suggested":false,"reason":"x"},"computedAt":"2026-10-29T06:00:00.000Z","futureField":[1,2]},"meta":{"version":2,"build":"abc"}}""",
        ).load()
        assertEquals("Row", signals.exercises.single().name)
        assertFalse(signals.deload!!.suggested)
    }

    @Test
    fun loadOrNullReturnsNullOnServerError() = runTest {
        val signals = api(
            """{"error":{"code":"dependency_unavailable","message":"down"}}""",
            HttpStatusCode.ServiceUnavailable,
        ).loadOrNull()
        assertNull(signals)
    }

    @Test
    fun loadOrNullReturnsNullOnUndecodableBody() = runTest {
        assertNull(api("""{"data":"not an object"}""").loadOrNull())
    }
}
