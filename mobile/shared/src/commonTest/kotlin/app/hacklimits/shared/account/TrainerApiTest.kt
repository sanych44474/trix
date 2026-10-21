package app.hacklimits.shared.account

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
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
import kotlin.test.assertNull

class TrainerApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): TrainerApi {
        val sessions = InMemorySessionStore("t".repeat(64))
        return TrainerApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    private suspend fun bodyOf(request: HttpRequestData): String =
        (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()

    @Test
    fun directoryDecodesTrainersAndPendingRequest() = runTest {
        val trainers = api { request ->
            assertEquals("/api/v2/trainers", request.url.encodedPath)
            respond(
                """{"data":{"role":"solo","trainers":[{"id":7,"name":"Max","specialization":"Strength","city":"Kyiv",
                "experienceYears":5,"priceOnline":900,"currency":"UAH","bio":"Hi"}],"pending":{"trainerId":7,"name":"Max"}},
                "meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val directory = trainers.directory()
        assertEquals("solo", directory.role)
        assertEquals(7L, directory.trainers.single().id)
        assertEquals("UAH", directory.trainers.single().currency)
        assertEquals("Max", directory.pending?.name)
    }

    @Test
    fun requestTrainerPostsTheTrainerId() = runTest {
        val trainers = api { request ->
            assertEquals(HttpMethod.Post, request.method)
            assertContains(bodyOf(request), "\"trainerId\":7")
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        trainers.requestTrainer(7)
    }

    @Test
    fun cancelRequestUsesDelete() = runTest {
        val trainers = api { request ->
            assertEquals(HttpMethod.Delete, request.method)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        trainers.cancelRequest()
    }

    @Test
    fun trainerProfileIsNullForAnyoneWhoNeverApplied() = runTest {
        val trainers = api { respond("""{"data":{"role":"solo","trainer":null},"meta":{"version":2}}""", HttpStatusCode.OK, json) }
        val r = trainers.trainerProfile()
        assertEquals("solo", r.role)
        assertNull(r.trainer)
    }

    @Test
    fun trainerProfileDecodesTheStatus() = runTest {
        val trainers = api {
            respond(
                """{"data":{"role":"trainer","trainer":{"status":"approved","name":"Max","bio":"","specialization":"",
                "approach":"","experienceYears":null,"priceOnline":null,"city":"","contact":"","accepting":true,"clients":3}},
                "meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val t = trainers.trainerProfile().trainer!!
        assertEquals("approved", t.status)
        assertEquals(3, t.clients)
    }

    @Test
    fun saveTrainerProfileSendsTheFields() = runTest {
        val trainers = api { request ->
            assertEquals("/api/v2/trainer/profile", request.url.encodedPath)
            val body = bodyOf(request)
            assertContains(body, "\"name\":\"Max\"")
            assertContains(body, "\"city\":\"Kyiv\"")
            respond("""{"data":{"ok":true,"pending":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        trainers.saveTrainerProfile("Max", "Strength", "Kyiv", "@max", "Bio")
    }

    @Test
    fun requestsDecodesTheInboxAndRespondSendsTheAction() = runTest {
        val trainers = api { request ->
            if (request.method == HttpMethod.Get) {
                respond(
                    """{"data":{"requests":[{"id":4,"clientId":9,"name":"Ann","note":""}]},"meta":{"version":2}}""",
                    HttpStatusCode.OK,
                    json,
                )
            } else {
                assertContains(bodyOf(request), "\"action\":\"accept\"")
                respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
            }
        }
        assertEquals("Ann", trainers.requests().single().name)
        trainers.respond(4, accept = true)
    }
}
