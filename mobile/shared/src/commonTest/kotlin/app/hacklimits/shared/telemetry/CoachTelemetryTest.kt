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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.Test
import kotlin.test.assertEquals

/** A ViewModel's feature event reaches POST /api/v2/event once the action succeeds. */
@OptIn(ExperimentalCoroutinesApi::class)
class CoachTelemetryTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun askingTheCoachTracksTheFirstQuestionAsAsk() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val events = mutableListOf<String>()
            val http = HttpClient(MockEngine { request ->
                when (request.url.encodedPath) {
                    "/api/v2/event" -> {
                        events += (request.body as TextContent).text
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
            advanceUntilIdle()

            assertEquals(listOf("""{"events":["app_coach_ask"]}"""), events)
        } finally {
            Dispatchers.resetMain()
        }
    }
}
