package app.hacklimits.shared.programs

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
import kotlin.test.assertTrue

class ProgramsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun client(handler: MockRequestHandler): ApiClient =
        ApiClient("https://api.example.test", InMemorySessionStore("a".repeat(64)), HttpClient(MockEngine(handler)))

    @Test
    fun theReadyProgramsDecodeWithTheirDays() = runTest {
        val api = ProgramsApi(client { request ->
            assertEquals("/api/v2/programs", request.url.encodedPath)
            respond(
                """{"data":{"role":"solo","programs":[{"id":"gym-beg-1","place":"gym","audience":"all","level":"beginner",
                  "daysPerWeek":3,"minutes":50,"name":"Full body","summary":"Three days","days":[{"title":"Day A",
                  "exercises":[{"name":"Squat","sets":"3 × 8"}]}]}]},"meta":{}}""",
                HttpStatusCode.OK, json,
            )
        })
        val r = api.list()
        assertEquals("solo", r.role)
        val p = r.programs.single()
        assertEquals("Full body", p.name)
        assertEquals("Squat", p.days.single().exercises.single().name)
    }

    @Test
    fun applyPostsTheProgramIdAsJson() = runTest {
        var body = ""
        var key: String? = null
        val api = ProgramsApi(client { request ->
            body = (request.body as TextContent).text
            key = request.headers["Idempotency-Key"]
            respond("""{"data":{"ok":true,"name":"Full body","weekdays":[1,3,5]},"meta":{}}""", HttpStatusCode.OK, json)
        })
        val result = api.apply("gym-beg-1")
        assertEquals("""{"id":"gym-beg-1"}""", body)
        assertTrue(!key.isNullOrBlank())
        assertEquals(listOf(1, 3, 5), result.weekdays)
    }

    @Test
    fun theSharedLibraryListsAndTakesByCode() = runTest {
        var takenBody = ""
        val api = SharedProgramsApi(client { request ->
            if (request.method.value == "POST") {
                takenBody = (request.body as TextContent).text
                respond("""{"data":{"ok":true,"name":"Coach plan"},"meta":{}}""", HttpStatusCode.OK, json)
            } else {
                respond("""{"data":{"role":"solo","programs":[{"code":"ab12","name":"Coach plan","takenCount":4}]},"meta":{}}""", HttpStatusCode.OK, json)
            }
        })
        val list = api.list().programs.single()
        assertEquals(4, list.takenCount)
        api.take(list.code)
        assertEquals("""{"code":"ab12"}""", takenBody)
    }
}
