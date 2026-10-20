package app.hacklimits.shared.social

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SocialApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun social(handler: MockRequestHandler): SocialApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return SocialApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun aSquadAtTheCapIsAnOkFalseResultNotAnError() = runTest {
        var key: String? = null
        val api = social { request ->
            assertEquals("/api/v2/squads", request.url.encodedPath)
            key = request.headers["Idempotency-Key"]
            respond("""{"data":{"ok":false,"reason":"too_many"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val result = api.createSquad("Crew", "k".repeat(36))
        assertFalse(result.ok)
        assertEquals("too_many", result.reason)
        assertEquals("k".repeat(36), key, "a created squad must carry the retry key")
    }

    @Test
    fun leavingASquadThatIsGoneReportsNotFound() = runTest {
        val api = social {
            respond("""{"error":{"code":"not_found","message":"not found"}}""", HttpStatusCode.NotFound, json)
        }
        assertEquals("not_found", assertFailsWith<ApiException> { api.leaveSquad(5) }.code)
    }

    @Test
    fun aViewerOutsideTheLeaderboardHasNoBoardsAndAViewerInsideHasRankZeroWhenUnranked() = runTest {
        var reply = """{"data":{"optedIn":false},"meta":{"version":2}}"""
        val api = social { respond(reply, HttpStatusCode.OK, json) }

        val out = api.boards()
        assertFalse(out.optedIn)
        assertNull(out.consistency)

        reply = """{"data":{"optedIn":true,"consistency":{"rank":0,"total":3,"top":[{"pos":1,"name":"Ann","value":4,"detail":"","me":false}]}},"meta":{"version":2}}"""
        val into = api.boards()
        assertTrue(into.optedIn)
        assertEquals(0, into.consistency!!.rank, "rank 0 means not on the board")
        assertNull(into.improved, "boards the server did not send stay null")
    }

    @Test
    fun invitePastedAsALinkOrTypedAsACodeResolvesToTheSameCode() {
        assertEquals("abc123", inviteCodeFrom("https://t.me/hack_limits_bot?start=sq_ABC123"))
        assertEquals("abc123", inviteCodeFrom("  ABC123 "))
    }
}
