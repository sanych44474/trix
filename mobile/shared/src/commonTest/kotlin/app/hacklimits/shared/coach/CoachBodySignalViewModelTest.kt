package app.hacklimits.shared.coach

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.telemetry.Telemetry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class CoachBodySignalViewModelTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun anInjurySignalStaysOnTheCoachLineAndTheReplyIsUnchanged() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            // MockEngine answers on its own thread: the test waits for the state rather than assuming it.
            val http = HttpClient(MockEngine { request ->
                when (request.url.encodedPath) {
                    "/api/v2/coach/ask" -> respond(
                        """{"data":{"answer":"Rest the knee this week.","actions":[],"bodySignal":{"kind":"injury"}},"meta":{"version":2}}""",
                        HttpStatusCode.OK, json,
                    )
                    "/api/v2/coach/thread" -> respond("""{"data":{"questions":[],"messages":[]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                    else -> respond("""{"data":{"ok":true,"counted":1},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }
            })
            val client = ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), http)
            val coach = CoachViewModel(CoachApi(client), Telemetry(client, CoroutineScope(StandardTestDispatcher(testScheduler))))
            awaitUntil { !coach.state.value.loading }

            coach.onInputChange("My knee hurts")
            coach.send()
            awaitUntil { coach.state.value.lines.size == 2 }

            val reply = coach.state.value.lines.last()
            assertEquals(CoachRole.Coach, reply.role)
            assertEquals("Rest the knee this week.", reply.text)
            assertEquals(BodyAlert.Injury, reply.bodySignal)
        } finally {
            Dispatchers.resetMain()
        }
    }
}

private suspend fun TestScope.awaitUntil(check: () -> Boolean) {
    repeat(400) {
        if (check()) return
        advanceUntilIdle()
        withContext(Dispatchers.Default) { delay(25) }
    }
}
