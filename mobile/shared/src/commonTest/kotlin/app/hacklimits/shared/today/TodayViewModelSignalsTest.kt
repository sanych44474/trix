package app.hacklimits.shared.today

import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.InMemoryKeyValueStore
import app.hacklimits.shared.data.InMemoryOfflineStore
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.NoOfflineSyncScheduler
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.TrainingSignalsApi
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.workout.PendingSaves
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertIs
import kotlin.test.assertNull

/** A failing training-signals call must not stop Today from loading, and leaves the signals null. */
@OptIn(ExperimentalCoroutinesApi::class)
class TodayViewModelSignalsTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val dashboard = """{"data":{"viewer":{"id":7,"role":"solo","onboarded":true,"planPending":false},"today":"2026-10-29"},"meta":{"version":2}}"""

    @BeforeTest fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @AfterTest fun reset() = Dispatchers.resetMain()

    private fun vm(engine: MockEngine): TodayViewModel {
        val sessions = InMemorySessionStore("t".repeat(64), 7L)
        val client = ApiClient("https://api.example.test", sessions, HttpClient(engine))
        val offline = InMemoryOfflineStore()
        val pending = PendingSaves(
            InMemoryKeyValueStore(), offline, WorkoutApi(client), NutritionApi(client), ProgressApi(client), sessions, NoOfflineSyncScheduler,
        )
        return TodayViewModel(DashboardApi(client), AccountCache(offline, sessions), pending, TrainingSignalsApi(client))
    }

    /** MockEngine answers on its own thread, outside the test scheduler: poll with short real-time waits. */
    private suspend fun TestScope.settle(done: () -> Boolean) {
        repeat(400) {
            if (done()) return
            advanceUntilIdle()
            withContext(Dispatchers.Default) { delay(25) }
        }
    }

    @Test
    fun aFailedSignalsCallLeavesSignalsNullAndTheDashboardStillLoads() = runTest {
        val signalsCalled = CompletableDeferred<Unit>()
        val model = vm(MockEngine { request ->
            when (request.url.encodedPath) {
                "/api/v2/training-signals" -> {
                    signalsCalled.complete(Unit)
                    respond("""{"error":{"code":"dependency_unavailable"}}""", HttpStatusCode.ServiceUnavailable, json)
                }
                else -> respond(dashboard, HttpStatusCode.OK, json)
            }
        })
        model.refresh()
        settle { signalsCalled.isCompleted && model.state.value is TodayViewModel.State.Ready }

        assertIs<TodayViewModel.State.Ready>(model.state.value)
        assertNull(model.signals.value)
    }
}
