package app.hacklimits.shared.settings

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ProfileApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): ProfileApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return ProfileApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun loadDecodesFieldsOptionsWeekdaysAndReferral() = runTest {
        val profile = api { request ->
            assertEquals("/api/v2/profile", request.url.encodedPath)
            respond(
                """{"data":{"photos":[],"referralLink":"https://t.me/bot?start=ref_1","referredCount":2,
                "profile":{"name":"Ann","goal":"strength","level":"beginner","goalWeight":72.5,"waterGoalMl":null,
                "stepsGoal":8000,"trainingWeekdays":[1,3,5],"share":{"body":true,"health":false}},
                "options":{"goal":[{"value":"strength","label":"Strength"}],"level":[{"value":"beginner","label":"Beginner"}]},
                "weekdays":[{"value":1,"label":"Mon"},{"value":2,"label":"Tue"}]},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val r = profile.load()
        assertEquals("Ann", r.profile.name)
        assertEquals(72.5, r.profile.goalWeight)
        assertEquals(listOf(1, 3, 5), r.profile.trainingWeekdays)
        assertEquals(true, r.profile.share?.body)
        assertEquals("Strength", r.options.goal.single().label)
        assertEquals("Tue", r.weekdays[1].label)
        assertEquals(2, r.referredCount)
    }

    @Test
    fun saveSendsNullsToClearAndTheWeekdays() = runTest {
        val profile = api { request ->
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertContains(body, "\"goalWeight\":null")
            assertContains(body, "\"waterGoalMl\":null")
            assertContains(body, "\"stepsGoal\":8000")
            assertContains(body, "\"trainingWeekdays\":[1,3]")
            assertTrue(!body.contains("\"share\""), body)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        profile.save(
            ProfileEdit(
                name = "Ann", goal = "strength", level = "beginner", goalWeight = null, waterGoalMl = null,
                stepsGoal = 8000, trainingWeekdays = listOf(1, 3), share = null,
            ),
        )
    }

    @Test
    fun saveSendsConsentForClients() = runTest {
        val profile = api { request ->
            val body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertContains(body, "\"share\":{\"body\":true,\"health\":false}")
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        profile.save(
            ProfileEdit(
                name = "Ann", goal = "", level = "", goalWeight = 70.0, waterGoalMl = 2000, stepsGoal = null,
                trainingWeekdays = emptyList(), share = ProfileResponse.Consent(body = true, health = false),
            ),
        )
    }
}
