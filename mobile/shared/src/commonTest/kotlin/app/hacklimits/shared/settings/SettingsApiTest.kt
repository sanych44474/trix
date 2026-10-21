package app.hacklimits.shared.settings

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.SettingsApi
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SettingsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): SettingsApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return SettingsApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    private suspend fun bodyOf(request: io.ktor.client.request.HttpRequestData): String =
        (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    private val stateJson = """
        {"data":{"onboarded":true,"reminders":[{"key":"all","label":"All","on":true},{"key":"water","label":"Water","on":false}],
        "vacationUntil":null,"lang":"en","role":"client",
        "cycle":{"on":true,"lastStart":"2026-10-01","len":28},"compete":{"on":true,"alias":"IronWolf"}},
        "meta":{"version":2}}
    """.trimIndent()

    @Test
    fun loadDecodesCycleCompeteAndReminders() = runTest {
        val settings = api { request ->
            assertEquals("/api/v2/settings", request.url.encodedPath)
            respond(stateJson, HttpStatusCode.OK, json)
        }
        val state = settings.load()
        assertEquals("client", state.role)
        assertEquals("2026-10-01", state.cycle?.lastStart)
        assertEquals(28, state.cycle?.len)
        assertTrue(state.compete.on)
        assertEquals("IronWolf", state.compete.alias)
        assertEquals(false, state.reminders[1].on)
    }

    @Test
    fun cycleSendsOnlyTheFieldsGiven() = runTest {
        val settings = api { request ->
            val body = bodyOf(request)
            assertContains(body, "\"action\":\"cycle\"")
            assertContains(body, "\"lastStart\":\"2026-10-01\"")
            assertTrue(!body.contains("\"on\""), body)
            respond("""{"data":{"ok":true,"state":{"lang":"en"}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        settings.cycle(lastStart = "2026-10-01")
    }

    @Test
    fun competeSendsAliasAndToggle() = runTest {
        val settings = api { request ->
            val body = bodyOf(request)
            assertContains(body, "\"action\":\"compete\"")
            assertContains(body, "\"on\":true")
            assertContains(body, "\"alias\":\"Wolf\"")
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertNull(settings.compete(on = true, alias = "Wolf"))
    }

    @Test
    fun feedbackPostsTheText() = runTest {
        val settings = api { request ->
            val body = bodyOf(request)
            assertContains(body, "\"action\":\"feedback\"")
            assertContains(body, "\"text\":\"Great app\"")
            respond("""{"data":{"ok":true,"state":{"lang":"en"}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        settings.feedback("Great app")
    }

    @Test
    fun leaveTrainerPostsTheAction() = runTest {
        val settings = api { request ->
            assertContains(bodyOf(request), "\"action\":\"leaveTrainer\"")
            respond("""{"data":{"ok":true,"state":{"lang":"en","role":"solo"}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        settings.leaveTrainer()
    }

    @Test
    fun exportReturnsTheAttachmentBytes() = runTest {
        val settings = api { request ->
            assertContains(bodyOf(request), "\"delivery\":\"download\"")
            respond(
                "# export".encodeToByteArray(),
                HttpStatusCode.OK,
                headersOf(HttpHeaders.ContentDisposition, "attachment; filename=\"hack-limits-export.md\""),
            )
        }
        assertEquals("# export", settings.export(json = false)?.decodeToString())
    }

    @Test
    fun exportWithNothingToSendReturnsNull() = runTest {
        val settings = api { respond("""{"ok":false,"reason":"empty"}""", HttpStatusCode.OK, json) }
        assertNull(settings.export(json = true))
    }
}
