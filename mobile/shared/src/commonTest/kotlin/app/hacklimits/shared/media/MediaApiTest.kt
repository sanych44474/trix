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

class MediaApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): MediaApi =
        MediaApi(ApiClient("https://api.example.test", InMemorySessionStore("c".repeat(64)), HttpClient(MockEngine(handler))))

    @Test
    fun mealPhotoIsSentAsMultipartAndTheEstimateIsReturned() = runTest {
        val api = api { request ->
            assertEquals(HttpMethod.Post, request.method)
            assertEquals("/api/v2/media/meal-photo", request.url.encodedPath)
            assertTrue(request.body.contentType?.match(ContentType.MultiPart.FormData) == true)
            respond(
                """{"data":{"items":[{"desc":"Rice","kcal":200,"protein":4,"fats":1,"carbs":44,"grams":150}]},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val items = api.estimateMealPhoto(byteArrayOf(1, 2, 3), "image/jpeg")
        assertEquals(1, items.size)
        assertEquals("Rice", items[0].desc)
        assertEquals(150.0, items[0].grams)
    }

    @Test
    fun aTooManyRequestsReplyCarriesTheRateLimitCode() = runTest {
        val api = api { respond("""{"error":{"code":"rate_limited","message":"limit"}}""", HttpStatusCode.TooManyRequests, json) }
        val e = assertFailsWith<ApiException> { api.estimateMealPhoto(byteArrayOf(1), "image/jpeg") }
        assertEquals("rate_limited", e.code)
    }

    @Test
    fun confirmedItemsAreLoggedUnderTheirIdempotencyKey() = runTest {
        var body = ""
        val api = api { request ->
            assertEquals("/api/v2/nutrition", request.url.encodedPath)
            assertEquals("key-00000001", request.headers["Idempotency-Key"])
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"totals":{}},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.addItems(listOf(LoggedFood("Rice", 200.0, 4.0, 1.0, 44.0, grams = 150.0)), "key-00000001")
        assertTrue(body.contains("\"action\":\"add_items\""), body)
        assertTrue(body.contains("\"grams\":150.0"), body)
    }

    @Test
    fun aFoodTextTheAiCannotReadIsReportedNotLogged() = runTest {
        val api = api { respond("""{"data":{"ok":false,"reason":"unreadable"},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        assertFalse(api.logFoodText("???", "key-00000002"))
    }
}
