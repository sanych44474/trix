package app.hacklimits.shared.social

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BuddyApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun social(reply: String): SocialApi {
        val engine = MockEngine { request ->
            assertEquals("/api/v2/buddy", request.url.encodedPath)
            respond(reply, HttpStatusCode.OK, json)
        }
        return SocialApi(ApiClient("https://api.example.test", InMemorySessionStore("b".repeat(64)), HttpClient(engine)))
    }

    @Test
    fun noPartnerIsABuddyOfNull() = runTest {
        assertNull(social("""{"data":{"buddy":null},"meta":{"version":2}}""").buddy().buddy)
    }

    @Test
    fun aPartnerDecodesTheStatsTheCardShows() = runTest {
        val buddy = social(
            """{"data":{"buddy":{"name":"Ann","level":3,"xp":240,"intoLevel":40,"needed":100,"streak":2,"weekWorkouts":4,"myWeekWorkouts":2,"week":[{"date":"2026-10-19","ex":["Squat"]}],"plan":[],"duel":{"myWins":1,"theirWins":0,"myStreak":1}}},"meta":{"version":2}}""",
        ).buddy().buddy!!
        assertEquals("Ann", buddy.name)
        assertEquals(3, buddy.level)
        assertEquals(40, buddy.intoLevel)
        assertEquals(100, buddy.needed)
        assertEquals(4, buddy.weekWorkouts)
        assertEquals(2, buddy.myWeekWorkouts)
    }
}
