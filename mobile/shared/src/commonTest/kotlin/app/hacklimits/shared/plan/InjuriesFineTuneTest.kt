package app.hacklimits.shared.plan

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
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InjuriesFineTuneTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun client(handler: MockRequestHandler): ApiClient =
        ApiClient("https://api.example.test", InMemorySessionStore("a".repeat(64)), HttpClient(MockEngine(handler)))

    @Test
    fun injuriesLoadWithTheirChoicesAndReportPostsAreaAndSeverity() = runTest {
        var body = ""
        val api = InjuriesApi(client { request ->
            if (request.method.value == "POST") {
                body = (request.body as TextContent).text
                respond("""{"data":{"ok":true},"meta":{}}""", HttpStatusCode.OK, json)
            } else {
                respond(
                    """{"data":{"injuries":[{"area":"Shoulder","severity":"Mild","since":"2026-10-01","lastScore":3}],
                      "areas":[{"value":"shoulder","label":"Shoulder"}],"severities":[{"value":"mild","label":"Mild"}]},"meta":{}}""",
                    HttpStatusCode.OK, json,
                )
            }
        })
        val payload = api.load()
        assertEquals("Shoulder", payload.injuries.single().area)
        assertEquals(3.0, payload.injuries.single().lastScore)
        api.report("shoulder", "mild")
        assertEquals("""{"area":"shoulder","severity":"mild"}""", body)
    }

    @Test
    fun aFineTuneAnswerIsSentAsASingleField() = runTest {
        var body = ""
        val api = FineTuneApi(client { request ->
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true},"meta":{}}""", HttpStatusCode.OK, json)
        })
        assertTrue(api.save("sessionMinutes", JsonPrimitive(45)))
        assertEquals("""{"sessionMinutes":45}""", body)
    }

    @Test
    fun aFailedFineTuneAnswerReportsFalseSoTheQuestionStays() = runTest {
        val api = FineTuneApi(client { respond("""{"error":"validation_error"}""", HttpStatusCode.BadRequest, json) })
        assertFalse(api.save("age", JsonPrimitive(30)))
    }
}
