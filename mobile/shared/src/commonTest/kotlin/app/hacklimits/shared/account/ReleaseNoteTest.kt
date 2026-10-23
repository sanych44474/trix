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

class ReleaseNoteTest {
    @Test
    fun latestCarriesTheServerParsedCards() = runTest {
        val note = latestFrom(
            """{"data":{"version":"2026.10.1","html":"<b>x</b>","text":"Hello\n\n✨ *New* — body",""" +
                """"items":[{"icon":"✨","title":"New","body":"Body"},{"icon":"","title":"","body":"Plain"}]},"meta":{"version":2}}""",
        )
        assertEquals("2026.10.1", note.version)
        assertEquals(
            listOf(ReleaseItem("✨", "New", "Body"), ReleaseItem("", "", "Plain")),
            note.items,
        )
    }

    @Test
    fun cardsDefaultToEmptyWhenTheServerSendsNone() = runTest {
        val note = latestFrom("""{"data":{"version":"2026.10.1","html":"","text":"Hello"},"meta":{"version":2}}""")
        assertEquals(emptyList(), note.items)
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
                            """{"data":{"version":"2026.10.1","html":"<b>x</b>","text":"Hello","items":[]},"meta":{"version":2}}""",
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
        assertEquals("2026.10.1", api.latest().version)
        api.markSeen("2026.10.1")
    }

    private suspend fun latestFrom(json: String): WhatsNewNote {
        val api = WhatsNewApi(
            ApiClient(
                "https://api.example.test",
                InMemorySessionStore("t".repeat(64)),
                HttpClient(MockEngine {
                    respond(json, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                }),
            ),
        )
        return api.latest()
    }

    private suspend fun body(request: HttpRequestData): String =
        (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
}
