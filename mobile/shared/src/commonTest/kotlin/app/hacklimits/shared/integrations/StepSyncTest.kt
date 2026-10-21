package app.hacklimits.shared.integrations

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.TrackingApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Health Connect with no steps (nothing syncs to it) falls back to the phone's counter, else says why. */
@OptIn(ExperimentalCoroutinesApi::class)
class StepSyncTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val posted = mutableListOf<String>()

    private class FakeHealth(
        private val store: Long?,
        private val sensor: Long?,
        private val sensorOn: Boolean,
        private val sources: List<String> = emptyList(),
    ) : HealthSync {
        override suspend fun available() = true
        override suspend fun hasPermission() = true
        override suspend fun todaySteps() = store
        override suspend fun stepSources() = sources
        override fun sensorAvailable() = true
        override fun sensorGranted() = sensorOn
        override suspend fun sensorSteps() = sensor
    }

    private fun vm(health: HealthSync): IntegrationsViewModel {
        val api = ApiClient("https://api.example.test", InMemorySessionStore("d".repeat(64)), HttpClient(MockEngine { request ->
            if (request.url.encodedPath.endsWith("/log")) posted += (request.body as TextContent).text
            respond("""{"data":{"ok":true,"available":false,"connected":false}}""", HttpStatusCode.OK, json)
        }))
        return IntegrationsViewModel(StravaApi(api), TrackingApi(api), health)
    }

    @BeforeTest fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @AfterTest fun reset() = Dispatchers.resetMain()

    @Test
    fun emptyHealthConnectFallsBackToThePhoneCounter() = runTest {
        val model = vm(FakeHealth(store = null, sensor = 4_321, sensorOn = true))
        model.refresh()
        model.syncSteps()
        // The step post runs on Ktor's dispatcher: wait for the result instead of reading too early.
        model.state.first { !it.healthBusy && it.healthSteps != null }
        assertEquals(4_321, model.state.value.healthSteps)
        assertTrue(model.state.value.stepsFromSensor)
        assertTrue(posted.single().contains("4321"))
    }

    @Test
    fun healthConnectWinsWhenItHasSteps() = runTest {
        val model = vm(FakeHealth(store = 8_000, sensor = 4_321, sensorOn = true))
        model.refresh()
        model.syncSteps()
        model.state.first { !it.healthBusy && it.healthSteps != null }
        assertEquals(8_000, model.state.value.healthSteps)
        assertEquals(false, model.state.value.stepsFromSensor)
    }

    @Test
    fun noStepsAnywhereShowsWhichAppsWriteToHealthConnect() = runTest {
        val model = vm(FakeHealth(store = 0, sensor = null, sensorOn = false, sources = listOf("Samsung Health")))
        model.refresh()
        model.syncSteps()
        assertTrue(model.state.value.healthNoSteps)
        assertEquals(listOf("Samsung Health"), model.state.value.healthSources)
        assertTrue(posted.isEmpty(), "nothing is logged")
    }
}
