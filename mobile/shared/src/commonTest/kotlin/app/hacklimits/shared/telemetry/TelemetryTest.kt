package app.hacklimits.shared.telemetry

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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    /** A client whose every request body is handed to [bodies]; the test awaits them, so timing is not guessed. */
    private fun client(bodies: Channel<String>, session: String? = "c".repeat(64)): ApiClient =
        ApiClient("https://api.example.test", InMemorySessionStore(session), HttpClient(MockEngine { request ->
            bodies.send((request.body as TextContent).text)
            respond("""{"data":{"ok":true,"counted":1},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }))

    @Test
    fun onlyAllowlistedAppNamesAreValid() {
        assertTrue(Telemetry.isValidEvent("app_form_check"))
        assertTrue(Telemetry.isValidEvent("app_nav_today"))
        assertTrue(Telemetry.isValidEvent("app_" + "a".repeat(40)))
        assertFalse(Telemetry.isValidEvent("app_x"))
        assertFalse(Telemetry.isValidEvent("form_check"))
        assertFalse(Telemetry.isValidEvent("app_Form"))
        assertFalse(Telemetry.isValidEvent("app_" + "a".repeat(41)))
    }

    @Test
    fun eventsAreBatchedAfterOneTickAndSentTogether() = runTest {
        val bodies = Channel<String>(Channel.UNLIMITED)
        val telemetry = Telemetry(client(bodies), CoroutineScope(StandardTestDispatcher(testScheduler)))
        telemetry.track("app_form_check")
        telemetry.track("app_Bogus")
        telemetry.track("app_csv_import")
        assertEquals("""{"events":["app_form_check","app_csv_import"]}""", bodies.receive())
        advanceUntilIdle()
        assertTrue(bodies.tryReceive().isFailure, "one request for the batch")
    }

    @Test
    fun aLongBurstIsSentInBatchesOfTen() = runTest {
        val bodies = Channel<String>(Channel.UNLIMITED)
        val telemetry = Telemetry(client(bodies), CoroutineScope(StandardTestDispatcher(testScheduler)))
        repeat(12) { telemetry.track("app_nav_today") }
        val first = bodies.receive()
        val second = bodies.receive()
        assertEquals(10, Regex("app_").findAll(first).count())
        assertEquals(2, Regex("app_").findAll(second).count())
    }

    @Test
    fun nothingIsSentWithoutASession() = runTest {
        val bodies = Channel<String>(Channel.UNLIMITED)
        val telemetry = Telemetry(client(bodies, session = null), CoroutineScope(StandardTestDispatcher(testScheduler)))
        telemetry.track("app_form_check")
        advanceUntilIdle()
        assertTrue(bodies.tryReceive().isFailure)
    }

    @Test
    fun errorReportsSkipNoiseRepeatsAndTheCap() {
        val seen = mutableSetOf<String>()
        assertNull(ClientErrorReporter.errorMessage(IllegalStateException("Failed to fetch"), seen))
        assertNull(ClientErrorReporter.errorMessage(IllegalStateException(""), seen))
        assertEquals("IllegalStateException: boom", ClientErrorReporter.errorMessage(IllegalStateException("boom"), seen))
        assertNull(ClientErrorReporter.errorMessage(IllegalStateException("boom"), seen))
        repeat(4) { assertTrue(ClientErrorReporter.errorMessage(IllegalStateException("e$it"), seen) != null) }
        assertNull(ClientErrorReporter.errorMessage(IllegalStateException("one more"), seen))
    }
}
