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
        assertEquals(listOf("2026-10-14", "2026-10-16"), clients[0].missedDates)

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
        val requestId = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("/api/v2/trainer/client/7/flag", request.url.encodedPath)
                    assertEquals(requestId, request.headers["Idempotency-Key"])
                    assertEquals("""{"flagged":true}""", (request.body as TextContent).text)
                    respond("""{"data":{"flagged":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }),
            ),
        )
        api.setFlag(7, flagged = true, key = requestId)
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
        api.nudgeInterview(7, key = "1a2b3c4d-0000-4000-8000-000000000001")
    }

    @Test
    fun cardDecodesReadinessHistoryPhotosAndTheDraftWindow() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { _ ->
                    respond(
                        """{"data":{"client":{"id":7,"name":"Anna","onboarded":false,"flagged":false},"note":null,"card":null,"draft":{"days":4,"exercises":18,"createdAt":"2026-10-19","autoActivatesAt":"2026-10-22","postponed":false},"cycle":{"phase":"luteal","day":21},"shared":{"health":{"limitations":"none","injuries":[{"area":"knee","severity":"mild","since":"2026-10-01"}]}},"noteHistory":[{"field":"healthNotes","value":"tendon","savedAt":"2026-10-10T09:30:00Z"}],"photos":[{"id":3,"takenAt":"2026-10-12"}],"messages":[],"dashboard":{"recovery":{"score":71.6,"label":"good","factors":[]},"gamification":{"level":4,"xp":120,"intoLevel":20,"needed":80,"streak":3}}},"meta":{"version":2}}""",
                        HttpStatusCode.OK, json,
                    )
                }),
            ),
        )
        val card = api.card(7)
        assertEquals(4, card.draft?.days)
        assertEquals("2026-10-22", card.draft?.autoActivatesAt)
        assertEquals("luteal", card.cycle?.phase)
        assertEquals("tendon", card.noteHistory.single().value)
        assertEquals(3L, card.photos?.single()?.id)
        assertEquals("good", card.dashboard?.recovery?.label)
        assertEquals(71.6, card.dashboard?.recovery?.score)
        assertEquals(3, card.dashboard?.gamification?.streak)
        assertEquals("knee", card.shared.health?.injuries?.single()?.area)
    }

    @Test
    fun unreadCountsAreKeyedByClientId() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("/api/v2/chat/unread", request.url.encodedPath)
                    respond("""{"data":{"bySender":{"7":2,"x":1,"9":0}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }),
            ),
        )
        assertEquals(mapOf(7L to 2, 9L to 0), api.chatUnread())
    }

    @Test
    fun draftDecisionPostsTheChoiceWithAKey() = runTest {
        val requestId = "5e6f7a8b-1c2d-4e3f-9a0b-1c2d3e4f5a6b"
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("/api/v2/trainer/client/7/draft", request.url.encodedPath)
                    assertEquals(requestId, request.headers["Idempotency-Key"])
                    assertEquals("""{"decision":"postpone"}""", (request.body as TextContent).text)
                    respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }),
            ),
        )
        api.decideDraft(7, "postpone", requestId)
    }

    @Test
    fun templateFromAClientWithoutAPlanIsNotFound() = runTest {
        val api = TrainerClientsApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore(token),
                HttpClient(MockEngine { request ->
                    assertEquals("/api/v2/trainer/templates", request.url.encodedPath)
                    assertEquals("""{"action":"create","name":"Push day","fromClientId":7}""", (request.body as TextContent).text)
                    respond("""{"error":{"code":"not_found","message":"not found"}}""", HttpStatusCode.NotFound, json)
                }),
            ),
        )
        assertEquals(404, assertFailsWith<ApiException> { api.createTemplate(7, "Push day", "9c8b7a6d-0000-4000-8000-000000000002") }.status)
    }
}
