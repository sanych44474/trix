package app.hacklimits.shared

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ApiClientTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun client(sessions: InMemorySessionStore, handler: MockRequestHandler): ApiClient =
        ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler)))

    @Test
    fun signInStoresTheSessionTokenAndIdentifiesAsNative() = runTest {
        val sessions = InMemorySessionStore()
        val api = client(sessions) { request ->
            assertEquals("native", request.headers["X-Client"])
            assertEquals("/api/v2/auth/email/verify", request.url.encodedPath)
            respond("""{"data":{"authenticated":true,"accountId":7,"method":"email","sessionToken":"${"a".repeat(64)}"}}""", HttpStatusCode.OK, json)
        }
        val session = AuthApi(api, sessions).verifyEmail("a@b.c", "c".repeat(32), "123456", "en")
        assertEquals(7, session.accountId)
        assertNull(session.sessionToken, "the token is stored, not passed around")
        assertEquals("a".repeat(64), sessions.token())
    }

    @Test
    fun bothErrorShapesBecomeACode() = runTest {
        val sessions = InMemorySessionStore()
        var shape = 0
        val api = client(sessions) {
            shape++
            when (shape) {
                1 -> respond("""{"error":{"code":"invalid_code","message":"x"}}""", HttpStatusCode.Unauthorized, json)
                2 -> respond("""{"error":"no_telegram_chat"}""", HttpStatusCode.Conflict, json)
                else -> respond("""{"error":{"code":"conflict","message":"no_telegram_chat"}}""", HttpStatusCode.Conflict, json)
            }
        }
        val auth = AuthApi(api, sessions)
        assertEquals("invalid_code", assertFailsWith<ApiException> { auth.verifyEmail("a@b.c", "c".repeat(32), "000000", "en") }.code)
        assertEquals("no_telegram_chat", assertFailsWith<ApiException> { auth.providers() }.code)
        assertEquals("no_telegram_chat", assertFailsWith<ApiException> { auth.providers() }.code, "v2 wrapper: generic code, specific message")
    }

    @Test
    fun aRejectedSessionIsReportedSoTheAppSignsOut() = runTest {
        val sessions = InMemorySessionStore("b".repeat(64))
        val api = client(sessions) { request ->
            assertEquals("Bearer ${"b".repeat(64)}", request.headers[HttpHeaders.Authorization])
            respond("""{"error":"unauthorized"}""", HttpStatusCode.Unauthorized, json)
        }
        assertFailsWith<ApiException> { DashboardApi(api).load() }
        // No collector yet (background work): the rejection is still there when the UI subscribes.
        assertEquals("b".repeat(64), api.sessionExpired.value)
        assertEquals("b".repeat(64), api.sessionExpired.first { it != null })
    }
}
