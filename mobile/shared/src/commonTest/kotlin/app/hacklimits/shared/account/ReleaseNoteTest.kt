package app.hacklimits.shared.account

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReleaseNoteTest {
    private val note = listOf(
        "Hi, here is what changed:",
        "🎯 *Smarter plans* — the plan adapts to your week.",
        "plain paragraph without a title",
        "Tap *Menu → Dashboard* to see more.",
    ).joinToString("\n\n")

    @Test
    fun parsesCardsAndDropsGreetingAndClosingLine() {
        val items = parseReleaseNote(note)
        assertEquals(2, items.size)
        assertEquals("🎯", items[0].icon)
        assertEquals("Smarter plans", items[0].title)
        assertEquals("The plan adapts to your week.", items[0].body)
        assertEquals("", items[1].title)
        assertEquals("plain paragraph without a title", items[1].body)
    }

    @Test
    fun stripsEmphasisAndCapitalisesTheBody() {
        val items = parseReleaseNote("Hello\n\n✨ *Title* — lowercase _emphasis_ text")
        assertEquals("Lowercase emphasis text", items.single().body)
    }

    @Test
    fun plainTextFallbackFromHtml() {
        assertEquals("a & b", plainReleaseText("<b>a</b>&nbsp;&amp; b").replace(Regex(" +"), " ").trim())
        assertTrue(!plainReleaseText("<b>x</b>").contains("<"))
    }

    @Test
    fun latestAndMarkSeenUseTheWhatsNewRoutes() = runTest {
        val sessions = InMemorySessionStore("t".repeat(64))
        val api = WhatsNewApi(
            ApiClient(
                "https://api.example.test",
                sessions,
                HttpClient(MockEngine { request ->
                    if (request.method == HttpMethod.Get) {
                        assertEquals("/api/v2/whatsnew", request.url.encodedPath)
                        respond(
                            """{"data":{"version":"2026.10.1","html":"<b>x</b>","text":"Hello\n\n✨ *New* — body"},"meta":{"version":2}}""",
                            HttpStatusCode.OK,
                            headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    } else {
                        assertEquals("/api/v2/whatsnew/seen", request.url.encodedPath)
                        assertContains(body(request), "\"version\":\"2026.10.1\"")
                        respond(
                            """{"data":{"ok":true},"meta":{"version":2}}""",
                            HttpStatusCode.OK,
                            headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    }
                }),
            ),
        )
        val note = api.latest()
        assertEquals("2026.10.1", note.version)
        assertEquals("New", releaseItems(note).single().title)
        api.markSeen("2026.10.1")
    }

    private suspend fun body(request: HttpRequestData): String =
        (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
}
