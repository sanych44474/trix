package app.hacklimits.shared.trainer.business

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
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
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TrainerBusinessApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun businessApi(handler: MockRequestHandler): TrainerBusinessApi {
        val client = ApiClient("https://api.example.test", InMemorySessionStore("c".repeat(64)), HttpClient(MockEngine(handler)))
        return TrainerBusinessApi(client)
    }

    @Test
    fun sessionsKeepTheServerNamesAndMoneyAsGiven() = runTest {
        val api = businessApi { request ->
            assertEquals("/api/v2/trainer/sessions", request.url.encodedPath)
            respond(
                """{"data":{"from":"2026-10-13T00:00:00.000Z","to":"2026-11-19T00:00:00.000Z",""" +
                    """"clients":[{"id":3,"name":"Ann"}],""" +
                    """"sessions":[{"id":9,"clientId":3,"clientName":"Ann","startsAt":"2026-10-20T15:00:00.000Z",""" +
                    """"durationMin":60,"status":"done","price":500,"note":""}]},"meta":{}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val result = api.sessions()
        assertEquals("Ann", result.clients.single().name)
        val row = result.sessions.single()
        assertEquals("done", row.status)
        assertEquals("500", formatAmount(row.price!!))
    }

    @Test
    fun createSendsIdempotencyKeyAndOmitsUnsetFields() = runTest {
        var key: String? = null
        var body = ""
        val api = businessApi { request ->
            key = request.headers["Idempotency-Key"]
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"id":12},"meta":{}}""", HttpStatusCode.OK, json)
        }
        val result = api.sessionAction(
            SessionAction("create", clientId = 3, startsAt = "2026-10-20T15:00:00.000Z", durationMin = 60),
            key = "11111111-2222-3333-4444-555555555555",
        )
        assertEquals(12, result.id)
        assertEquals("11111111-2222-3333-4444-555555555555", key)
        assertTrue(body.contains("\"action\":\"create\""), body)
        assertTrue(body.contains("\"clientId\":3"), body)
        assertTrue(!body.contains("price"), "an unset price is left out, so the server keeps its default: $body")
        assertTrue(!body.contains("note"), body)
    }

    @Test
    fun aMissingClientComesBackAsTheSharedNotFoundCode() = runTest {
        val api = businessApi {
            respond("""{"error":{"code":"not_found","message":"not found"}}""", HttpStatusCode.NotFound, json)
        }
        val e = assertFailsWith<ApiException> { api.sessionAction(SessionAction("delete", id = 99), key = "k".repeat(8)) }
        assertEquals("not_found", e.code)
    }
}
