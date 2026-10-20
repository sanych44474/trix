package app.hacklimits.shared.integrations

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.TrackingApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class IntegrationsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val token = "d".repeat(64)

    private fun client(handler: MockRequestHandler): ApiClient =
        ApiClient("https://api.example.test", InMemorySessionStore(token), HttpClient(MockEngine(handler)))

    @Test
    fun stravaStatusDecodesTheEnvelopeAndSendsTheBearer() = runTest {
        val api = StravaApi(client { request ->
            assertEquals("/api/v2/strava", request.url.encodedPath)
            assertEquals("Bearer $token", request.headers[HttpHeaders.Authorization])
            respond(
                """{"data":{"available":true,"connected":true,"lastSyncAt":"2026-10-19T10:00:00Z","lastError":null},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        })
        val status = api.status()
        assertTrue(status.available && status.connected)
        assertEquals("2026-10-19T10:00:00Z", status.lastSyncAt)
        assertEquals(null, status.lastError)
    }

    @Test
    fun aSyncFailureSurfacesTheServerCode() = runTest {
        val api = StravaApi(client {
            respond(
                """{"error":{"code":"dependency_unavailable","message":"Strava unavailable"}}""",
                HttpStatusCode.ServiceUnavailable, json,
            )
        })
        val error = assertFailsWith<ApiException> { api.sync() }
        assertEquals("dependency_unavailable", error.code)
        assertEquals(503, error.status)
    }

    @Test
    fun connectReturnsTheAuthorizeUrlFromThePost() = runTest {
        val api = StravaApi(client { request ->
            assertEquals(HttpMethod.Post, request.method)
            respond("""{"data":{"url":"https://www.strava.com/oauth/authorize?state=x"}}""", HttpStatusCode.OK, json)
        })
        assertEquals("https://www.strava.com/oauth/authorize?state=x", api.connectUrl())
    }

    @Test
    fun aStepLogIsPostedAsStepsWithAnIdempotencyKey() = runTest {
        val key = "k".repeat(16)
        val api = TrackingApi(client { request ->
            assertEquals("/api/v2/log", request.url.encodedPath)
            assertEquals(key, request.headers["Idempotency-Key"])
            val body = (request.body as TextContent).text
            assertTrue(body.contains("\"kind\":\"steps\""), body)
            assertTrue(body.contains("\"steps\":8421"), body)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        })
        api.steps(8421, key)
    }
}
