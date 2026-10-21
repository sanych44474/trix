package app.hacklimits.shared.onboarding

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.BasicsRequest
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.OnboardingApi
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OnboardingApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): OnboardingApi =
        OnboardingApi(ApiClient("https://api.example.test", InMemorySessionStore("a".repeat(64)), HttpClient(MockEngine(handler))))

    @Test
    fun aServerDraftIsRestoredAndAMissingOneIsNull() = runTest {
        val withDraft = api { respond("""{"data":{"answers":{"sex":"male","age":31,"trainingWeekdays":[2]}},"meta":{}}""", HttpStatusCode.OK, json) }
        val draft = withDraft.loadDraft()
        assertEquals("male", draft?.sex)
        assertEquals(listOf(2), draft?.trainingWeekdays)
        val none = api { respond("""{"data":{"answers":null},"meta":{}}""", HttpStatusCode.OK, json) }
        assertNull(none.loadDraft())
    }

    @Test
    fun aDraftSaveCarriesTheCountsTheOwnerFunnelReads() = runTest {
        var body = ""
        val api = api { request ->
            assertEquals("/api/v2/onboarding/draft", request.url.encodedPath)
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true},"meta":{}}""", HttpStatusCode.OK, json)
        }
        api.saveDraft(Answers(sex = "female"), answered = 1, total = 13)
        assertEquals("""{"answers":{"sex":"female"},"answered":1,"total":13}""", body)
    }

    @Test
    fun theSubmitPostsTheRequestBody() = runTest {
        var body = ""
        val api = api { request ->
            assertEquals("/api/v2/onboarding", request.url.encodedPath)
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true},"meta":{}}""", HttpStatusCode.OK, json)
        }
        val request = toRequest(
            Answers(
                sex = "male", age = 30, heightCm = 180, weightKg = 80.0, goal = "muscle gain", level = "beginner",
                trainingWeekdays = listOf(1, 3), sessionMinutes = 60, equipment = "full gym", lifestyle = "moderate",
                sleepSchedule = "evening", dietPrefs = "none", limitations = "none",
            ),
            isClient = false,
            timezone = null,
        )!!
        api.submit(request)
        assertTrue(body.contains("\"goal\":\"muscle gain\""))
        assertTrue(body.contains("\"baselineLifts\":\"none\""))
        assertTrue(!body.contains("timezone"), "no timezone key when none was sent")
    }

    @Test
    fun theBasicsGoToTheProfileAsFourFields() = runTest {
        var path = ""
        var body = ""
        val api = api { request ->
            path = request.url.encodedPath
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true},"meta":{}}""", HttpStatusCode.OK, json)
        }
        api.saveBasics(BasicsRequest(sex = "female", age = 25, heightCm = 165, weightKg = 58.5))
        assertEquals("/api/v2/profile", path)
        assertEquals("""{"sex":"female","age":25,"heightCm":165,"weightKg":58.5}""", body)
    }
}
