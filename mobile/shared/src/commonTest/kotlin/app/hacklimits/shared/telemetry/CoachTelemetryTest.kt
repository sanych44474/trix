package app.hacklimits.shared.telemetry

import app.hacklimits.shared.coach.CoachApi
import app.hacklimits.shared.coach.CoachViewModel
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A ViewModel's feature event reaches POST /api/v2/event once the action succeeds. */
@OptIn(ExperimentalCoroutinesApi::class)
class CoachTelemetryTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun askingTheCoachTracksTheFirstQuestionAsAsk() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            // MockEngine answers on its own thread, outside the test scheduler: advanceUntilIdle()
            // can return while the POST is still in flight, so the test waits for the event itself,
            // advancing the scheduler between short real-time waits (the request may hop back to it).
            val firstEvent = CompletableDeferred<String>()
            val http = HttpClient(MockEngine { request ->
                when (request.url.encodedPath) {
                    "/api/v2/event" -> {
                        firstEvent.complete((request.body as TextContent).text)
                        respond("""{"data":{"ok":true,"counted":1},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                    }
                    "/api/v2/coach/ask" ->
                        respond("""{"data":{"answer":"Take an easy day.","actions":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                    else ->
                        respond("""{"data":{"questions":[],"messages":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }
            })
            val client = ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), http)
            val telemetry = Telemetry(client, CoroutineScope(StandardTestDispatcher(testScheduler)))
            val coach = CoachViewModel(CoachApi(client), telemetry)
            advanceUntilIdle()

            coach.onInputChange("Rest tomorrow?")
            coach.send()
            repeat(400) {
                if (firstEvent.isCompleted) return@repeat
                advanceUntilIdle()
                withContext(Dispatchers.Default) { delay(25) }
            }

            assertTrue(firstEvent.isCompleted, "no event was posted")
            assertEquals("""{"events":["app_coach_ask"]}""", firstEvent.getCompleted())
        } finally {
            Dispatchers.resetMain()
        }
    }
}
