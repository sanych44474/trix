package app.hacklimits.shared.trainertools

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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrainerToolsApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun tools(handler: MockRequestHandler): TrainerToolsApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return TrainerToolsApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    @Test
    fun aLibraryPublishSendsTheModeAndKeyAndHasNoLink() = runTest {
        var body = ""
        var key: String? = null
        val api = tools { request ->
            assertEquals("/api/v2/trainer/share/template", request.url.encodedPath)
            body = (request.body as TextContent).text
            key = request.headers["Idempotency-Key"]
            respond("""{"data":{"ok":true,"code":"abc12345","name":"PPL"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val r = api.publishTemplate(7, library = true, key = "k".repeat(36))
        assertEquals("abc12345", r.code)
        assertNull(r.link)
        assertTrue(body.contains("\"mode\":\"library\"") && body.contains("\"templateId\":7"), body)
        assertEquals("k".repeat(36), key)
    }

    @Test
    fun aLinkPublishReturnsTheDeepLink() = runTest {
        val api = tools { respond("""{"data":{"ok":true,"code":"abc12345","name":"PPL","link":"https://t.me/bot?start=prog_abc12345"},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        assertEquals("https://t.me/bot?start=prog_abc12345", api.publishTemplate(7, library = false, key = "k".repeat(36)).link)
    }

    @Test
    fun assignSendsTheSelectedClientIds() = runTest {
        var body = ""
        val api = tools { request ->
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"assigned":2,"total":2},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val r = api.assign(7, listOf(20, 21), key = "k".repeat(36))
        assertEquals(2, r.assigned)
        assertTrue(body.contains("\"clientIds\":[20,21]"), body)
    }

    @Test
    fun aNonInstructorIsRefusedWithAForbiddenCode() = runTest {
        val api = tools { respond("""{"error":{"code":"forbidden","message":"forbidden"}}""", HttpStatusCode.Forbidden, json) }
        assertEquals("forbidden", assertFailsWith<ApiException> { api.publishOwnPlan("PPL", "k".repeat(36)) }.code)
    }

    @Test
    fun theCleanupPreviewHasNoKeyAndTheConfirmCarriesOne() = runTest {
        val keys = mutableListOf<String?>()
        var confirmBody = ""
        val api = tools { request ->
            keys += request.headers["Idempotency-Key"]
            if (request.body is TextContent && (request.body as TextContent).text.contains("confirm")) {
                confirmBody = (request.body as TextContent).text
                respond("""{"data":{"deleted":3},"meta":{"version":2}}""", HttpStatusCode.OK, json)
            } else {
                respond("""{"data":{"count":3,"days":7},"meta":{"version":2}}""", HttpStatusCode.OK, json)
            }
        }
        assertEquals(3, api.cleanupPreview().count)
        assertNull(keys[0])
        assertEquals(3, api.cleanupConfirm(key = "k".repeat(36)).deleted)
        assertEquals("k".repeat(36), keys[1])
        assertTrue(confirmBody.contains("\"confirm\":true"), confirmBody)
    }

    @Test
    fun theWeeklyReportParsesRowsMostActiveFirst() = runTest {
        val api = tools {
            respond(
                """{"data":{"clientCount":2,"active7":1,"activePct":50,"rows":[{"id":20,"name":"Ann","username":"ann","onboarded":true,"interview":{"filled":8,"total":8},"plan":{"active":true,"draft":false},"events":{"workouts":4,"checkins":2,"nutrition":5,"steps":0},"lastSeen":"2026-10-20T10:00:00.000Z","botBlocked":false},{"id":21,"name":null,"username":null,"onboarded":false,"interview":{"filled":2,"total":8},"plan":{"active":false,"draft":false},"events":{"workouts":0,"checkins":0,"nutrition":0,"steps":0},"lastSeen":null,"botBlocked":true}]},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val report = api.report()
        assertEquals(50, report.activePct)
        assertEquals(listOf(20L, 21L), report.rows.map { it.id })
        assertEquals(4, report.rows[0].events.workouts)
        assertTrue(report.rows[1].botBlocked)
    }
}
