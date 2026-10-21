package app.hacklimits.shared.inbox

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class InboxTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun inbox(handler: MockRequestHandler): InboxApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return InboxApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    private fun item(kind: String, params: String = "{}") = InboxItem(
        id = 1,
        kind = kind,
        params = Json.parseToJsonElement(params).jsonObject,
        createdAt = "2026-10-20T10:00:00.000Z",
        read = false,
    )

    @Test
    fun feedDecodesTheItemsAndTheUnreadCount() = runTest {
        val api = inbox { request ->
            assertEquals("/api/v2/inbox", request.url.encodedPath)
            assertEquals(HttpMethod.Get, request.method)
            respond(
                """{"data":{"items":[{"id":5,"kind":"badge","params":{"code":"iron","en":"Iron"},"createdAt":"2026-10-20T10:00:00.000Z","read":false},{"id":4,"kind":"unknown_future","params":{},"createdAt":"2026-10-19 09:00:00","read":true}],"unread":1},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val feed = api.feed()
        assertEquals(1, feed.unread)
        assertEquals(listOf(5L, 4L), feed.items.map { it.id })
        assertEquals("Iron", feed.items[0].params["en"]?.toString()?.trim('"'))
    }

    @Test
    fun markReadPostsToTheReadRoute() = runTest {
        val api = inbox { request ->
            assertEquals("/api/v2/inbox/read", request.url.encodedPath)
            assertEquals(HttpMethod.Post, request.method)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.markRead()
    }

    @Test
    fun badgeNameFollowsTheLanguageAndFallsBackToTheCode() {
        val params = """{"en":"Iron","uk":"Залізо","code":"iron"}"""
        assertEquals("Iron", inboxLine(item("badge", params), uk = false)!!.args.single())
        assertEquals("Залізо", inboxLine(item("badge", params), uk = true)!!.args.single())
        assertEquals("iron", inboxLine(item("badge", """{"code":"iron"}"""), uk = false)!!.args.single())
    }

    @Test
    fun squadWeekNamesTheTopThreeAndUsesThePastCopyForLastWeek() {
        val line = inboxLine(
            item("squad_week", """{"past":true,"total":5,"top":[{"medal":"🥇","name":"Ann","workouts":3},{"medal":"🥈","name":"Bo","workouts":2}]}"""),
            uk = false,
        )!!
        assertEquals(InboxCopy.SQUAD_WEEK_PAST, line.copy)
        assertIs<DefaultSquadName>(line.args[0], "an unnamed squad falls back to the localized default")
        assertEquals("🥇 Ann 3 · 🥈 Bo 2", line.args[1])
        assertEquals(5, line.args[2])
    }

    @Test
    fun aMessageFromAnUnknownSenderShowsADash() {
        val line = inboxLine(item("message", """{"fromName":"","preview":"Hi"}"""), uk = false)!!
        assertEquals(listOf("—", "Hi"), line.args)
    }

    @Test
    fun aKindThisBuildDoesNotKnowIsLeftOutOfTheFeed() {
        assertNull(inboxLine(item("future_kind"), uk = false))
        assertNull(inboxTarget("future_kind"))
    }

    @Test
    fun eachKindLeadsToTheScreenTheMiniAppOpens() {
        assertEquals(InboxTarget.Plan, inboxTarget("plan_changed"))
        assertEquals(InboxTarget.Role, inboxTarget("message"))
        assertEquals(InboxTarget.Progress, inboxTarget("badge"))
        assertEquals(InboxTarget.Today, inboxTarget("feedback_done"))
        assertEquals(InboxTarget.More, inboxTarget("squad_pr"))
    }

    @Test
    fun theWhenLabelIsTheClockThenYesterdayThenADate() {
        val now = Instant.parse("2026-10-20T12:00:00Z")
        val utc = TimeZone.UTC
        assertEquals(InboxWhen.Clock("09:30"), inboxWhen("2026-10-20T09:30:00Z", now, utc))
        // Same 24 h bucket rule as the Mini App: 13 h ago still shows the clock.
        assertEquals(InboxWhen.Clock("23:00"), inboxWhen("2026-10-19T23:00:00Z", now, utc))
        assertEquals(InboxWhen.Yesterday, inboxWhen("2026-10-19T10:00:00Z", now, utc))
        assertEquals(InboxWhen.Day("18.10"), inboxWhen("2026-10-18T10:00:00Z", now, utc))
        assertEquals(InboxWhen.Clock("09:30"), inboxWhen("2026-10-20 09:30:00", now, utc))
        assertNull(inboxWhen("not a date", now, utc))
    }
}
