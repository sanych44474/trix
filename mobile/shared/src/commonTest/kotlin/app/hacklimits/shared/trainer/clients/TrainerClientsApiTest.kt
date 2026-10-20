package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TrainerClientsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val token = "c".repeat(64)

    @Test
    fun clientListAndCardDecodeFromTheEnvelope() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("Bearer $token", request.headers[HttpHeaders.Authorization])
                    when (request.url.encodedPath) {
                        "/api/v2/dashboard" -> respond(
                            """{"data":{"viewer":{"id":1,"role":"trainer"},"today":"2026-10-20","trainer":{"clients":[{"id":7,"name":"Anna","workoutPct":80,"nutritionPct":50.5,"atRisk":true,"flagged":false,"onboarded":true,"plan":"active","missedDates":["2026-10-14","2026-10-16"]}]}},"meta":{"version":2}}""",
                            HttpStatusCode.OK, json,
                        )
                        "/api/v2/trainer/client/7/card" -> respond(
                            """{"data":{"client":{"id":7,"name":"Anna","onboarded":true,"flagged":true},"note":"ask about knees","card":{"healthNotes":"knee","personalNotes":null,"birthday":"03-14"},"draft":{"days":3,"exercises":12,"createdAt":"2026-10-19"},"shared":{"body":{"weightKg":62.5}},"noteHistory":[],"messages":[],"dashboard":{"anything":true}},"meta":{"version":2}}""",
                            HttpStatusCode.OK, json,
                        )
                        else -> error("unexpected ${request.url.encodedPath}")
                    }
                }),
            ),
        )

        val clients = api.clients()
        assertEquals(1, clients.size)
        assertEquals(7L, clients[0].id)
        assertEquals("active", clients[0].plan)
        assertTrue(clients[0].atRisk)

        val card = api.card(7)
        assertEquals("Anna", card.client.name)
        assertTrue(card.client.flagged)
        assertEquals("ask about knees", card.note)
        assertEquals("03-14", card.card?.birthday)
        assertEquals(3, card.draft?.days)
        assertEquals(62.5, card.shared.body?.weightKg)
        assertEquals(null, card.shared.health, "health is absent when the client did not share it")
    }

    @Test
    fun flagPostCarriesAnIdempotencyKeyAndAJsonBody() = runTest {
        val key = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("/api/v2/trainer/client/7/flag", request.url.encodedPath)
                    assertEquals(key, request.headers["Idempotency-Key"])
                    assertEquals("""{"flagged":true}""", (request.body as TextContent).text)
                    respond("""{"data":{"flagged":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }),
            ),
        )
        api.setFlag(7, flagged = true, key = key)
    }

    @Test
    fun aMissingClientIsNotFoundNotAGenericError() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { _ ->
                    respond("""{"error":{"code":"not_found","message":"not found"}}""", HttpStatusCode.NotFound, json)
                }),
            ),
        )
        assertEquals("not_found", assertFailsWith<ApiException> { api.card(99) }.code)
    }

    @Test
    fun nudgeReportsWhenTheClientAlreadyFinished() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("{}", (request.body as TextContent).text, "the server reads a JSON body on every trainer POST")
                    respond("""{"data":{"ok":true,"alreadyOnboarded":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }),
            ),
        )
        assertTrue(api.nudgeInterview(7, key = "1a2b3c4d-0000-4000-8000-000000000001"))
    }
}
