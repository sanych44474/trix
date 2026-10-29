package app.hacklimits.shared.media

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MediaUploadsTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): MediaApi =
        MediaApi(ApiClient("https://api.example.test", InMemorySessionStore("c".repeat(64)), HttpClient(MockEngine(handler))))

    @Test
    fun formCheckSendsTheClipAndReturnsTheCues() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/media/form-check", request.url.encodedPath)
            assertTrue(request.body.contentType?.match(ContentType.MultiPart.FormData) == true)
            respond("""{"data":{"ok":true,"text":"Keep the chest up."},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val r = api.formCheck(byteArrayOf(1, 2, 3), "video/mp4", "back squat", 12.4)
        assertTrue(r.ok)
        assertEquals("Keep the chest up.", r.text)
    }

    @Test
    fun aRefusedClipCarriesItsReasonAndTheLimit() = runTest {
        val api = api { respond("""{"data":{"ok":false,"reason":"limit","limit":5},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        val r = api.formCheck(byteArrayOf(1), "video/mp4", null, null)
        assertEquals(false, r.ok)
        assertEquals("limit", r.reason)
        assertEquals(5, r.limit)
    }

    @Test
    fun csvImportReturnsTheCountsAndTheCap() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/media/import-csv", request.url.encodedPath)
            respond("""{"data":{"ok":true,"imported":12,"skipped":3,"capped":true,"cap":200,"format":"strong"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val r = api.importCsv("Date,Exercise\n".encodeToByteArray())
        assertTrue(r.ok)
        assertEquals(12, r.imported)
        assertEquals(3, r.skipped)
        assertTrue(r.capped)
        assertEquals(200, r.cap)
    }

    @Test
    fun aWrongFormatCsvIsReportedNotThrown() = runTest {
        val api = api { respond("""{"data":{"ok":false,"reason":"wrong_format"},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        val r = api.importCsv(byteArrayOf(0x41))
        assertEquals("wrong_format", r.reason)
    }

    @Test
    fun transcribeReturnsTheText() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/media/transcribe", request.url.encodedPath)
            respond("""{"data":{"text":"two sets of bench"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals("two sets of bench", api.transcribe(byteArrayOf(1, 2), "audio/webm", "webm"))
    }

    @Test
    fun aMealPhotoWithACaptionStillGoesOutAsMultipartAndDecodes() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/media/meal-photo", request.url.encodedPath)
            assertTrue(request.body.contentType?.match(ContentType.MultiPart.FormData) == true)
            respond("""{"data":{"items":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertTrue(api.estimateMealPhoto(byteArrayOf(1), "image/jpeg", caption = "200 g rice").items.isEmpty())
    }

    @Test
    fun aFormCheckRateLimitIsAnApiErrorWithItsCode() = runTest {
        val api = api { respond("""{"error":{"code":"rate_limited","message":"limit"}}""", HttpStatusCode.TooManyRequests, json) }
        val e = assertFailsWith<ApiException> { api.formCheck(byteArrayOf(1), "video/mp4", null, null) }
        assertEquals("rate_limited", e.code)
    }

    @Test
    fun clipGateRefusesOversizeAndLongClipsAndAcceptsTheRest() {
        assertEquals(ClipGate.OK, clipGate(1_000, 30.0))
        assertEquals(ClipGate.OK, clipGate(1_000, null))
        assertEquals(ClipGate.OK, clipGate(1_000, 60.4))
        assertEquals(ClipGate.TOO_LONG, clipGate(1_000, 61.0))
        assertEquals(ClipGate.TOO_BIG, clipGate(MAX_VIDEO_BYTES + 1, 10.0))
    }
}
