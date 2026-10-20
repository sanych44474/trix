package app.hacklimits.shared.owner

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OwnerApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun owner(handler: MockRequestHandler): OwnerApi =
        OwnerApi(ApiClient("https://api.example.test", InMemorySessionStore("c".repeat(64)), HttpClient(MockEngine(handler))))

    private fun HttpRequestData.jsonBody(): String = (body as TextContent).text

    @Test
    fun isOwnerIsTrueOnlyWhenTheProbeSucceeds() = runTest {
        assertTrue(owner { respond("""{"data":{"version":"x","pending":0,"queue":false}}""", HttpStatusCode.OK, json) }.isOwner())
        assertFalse(owner { respond("""{"error":"not found"}""", HttpStatusCode.NotFound, json) }.isOwner())
        assertFalse(owner { throw IllegalStateException("offline") }.isOwner())
    }

    @Test
    fun reportAsksForOneSection() = runTest {
        val api = owner { request ->
            assertEquals(HttpMethod.Get, request.method)
            assertEquals("/api/v2/owner/report", request.url.encodedPath)
            assertEquals("retention", request.url.parameters["section"])
            respond("""{"data":{"html":"<b>Week 1</b> 42%"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals("<b>Week 1</b> 42%", api.report("retention"))
    }

    @Test
    fun usersDecodeTheRosterAndIgnoreTheFeedbackPart() = runTest {
        val api = owner {
            respond(
                """{"data":{"rows":[{"id":7,"name":"Ann","nick":"@ann","trainer":"","status":"onboarding","onb":"3/9","w":2,"c":1,"n":0,"s":4,"last":"10-19","total":7,"lastSeen":"2026-10-19T08:00:00.000Z"}],"feedback":[]},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val rows = api.users()
        assertEquals(1, rows.size)
        assertEquals(7L, rows[0].id)
        assertEquals("onboarding", rows[0].status)
        assertEquals("2026-10-19T08:00:00.000Z", rows[0].lastSeen)
    }

    @Test
    fun moderateBuildsTheActionPathWithItsIdempotencyKey() = runTest {
        val api = owner { request ->
            assertEquals(HttpMethod.Post, request.method)
            assertEquals("/api/v2/owner/user/42/block", request.url.encodedPath)
            assertEquals("key-block", request.headers["Idempotency-Key"])
            respond("""{"data":{"ok":true,"blocked":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.moderate(42L, "block", "key-block")
    }

    @Test
    fun nudgeOfAnOnboardedUserIsAConflictWithItsCode() = runTest {
        val api = owner { respond("""{"error":"already onboarded"}""", HttpStatusCode.Conflict, json) }
        val e = assertFailsWith<ApiException> { api.moderate(42L, "nudge", "k") }
        assertEquals("already onboarded", e.code)
    }

    @Test
    fun feedbackUpdateSendsNotifyOnlyWhenMarkingDone() = runTest {
        val bodies = mutableListOf<String>()
        val api = owner { request ->
            assertEquals("/api/v2/owner/feedback/9", request.url.encodedPath)
            bodies += request.jsonBody()
            respond("""{"data":{"ok":true,"notified":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertTrue(api.updateFeedback(9L, "done", null, notify = true, key = "k1"))
        api.updateFeedback(9L, "wontfix", null, notify = true, key = "k2")
        api.updateFeedback(9L, null, "bug", notify = true, key = "k3")
        assertTrue(bodies[0].contains("\"notify\":true"), bodies[0])
        assertFalse(bodies[1].contains("notify"), bodies[1])
        assertEquals("""{"category":"bug"}""", bodies[2])
    }

    @Test
    fun feedbackListDecodesRowsAndCounts() = runTest {
        val api = owner { request ->
            assertEquals("new", request.url.parameters["status"])
            respond(
                """{"data":{"rows":[{"id":3,"userId":5,"text":"Add rest timer","date":"2026-10-18","category":"idea","status":"new"}],"counts":{"new":1,"done":4,"wontfix":0}},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val page = api.feedback("new")
        assertEquals("idea", page.rows.single().category)
        assertEquals(4, page.counts.done)
    }

    @Test
    fun announceSendsTheTextAndTheBatchCursor() = runTest {
        val bodies = mutableListOf<String>()
        val api = owner { request ->
            bodies += request.jsonBody()
            respond("""{"data":{"sent":25,"failed":1,"total":60,"remaining":34,"next":120},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val first = api.announce("Hello", after = null, key = "a")
        assertEquals(120L, first.next)
        assertEquals("""{"text":"Hello"}""", bodies[0])
        api.announce("Hello", after = 120L, key = "b")
        assertTrue(bodies[1].contains("\"after\":120"), bodies[1])
    }

    @Test
    fun promoImageOverTheBudgetIsA429() = runTest {
        val api = owner { respond("""{"error":{"code":"rate_limited","message":"budget"}}""", HttpStatusCode.TooManyRequests, json) }
        val e = assertFailsWith<ApiException> { api.promoImage("a cat", "k") }
        assertEquals(429, e.status)
        assertEquals("rate_limited", e.code)
    }

    @Test
    fun releaseInfoAndAskInactiveDecode() = runTest {
        val api = owner { request ->
            if (request.url.encodedPath.endsWith("ask-inactive")) {
                respond("""{"data":{"sent":4,"total":6},"meta":{"version":2}}""", HttpStatusCode.OK, json)
            } else {
                respond("""{"data":{"version":"1.4.0","pending":12,"queue":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
            }
        }
        val info = api.release()
        assertEquals(12, info.pending)
        assertTrue(info.queue)
        assertEquals(4, api.askInactive("k"))
    }
}
