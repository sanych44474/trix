package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.media.MediaApi
import app.hacklimits.shared.media.SpeechInput
import app.hacklimits.shared.platform.AppPlatform
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class TrainerClientLogViewModelTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val platform = object : AppPlatform {
        override val language = "uk"
        override val appVersion = "test"
        override val pushPlatform = "android"
        override val privacyPolicyUrl: String? = null
    }
    private val heard = object : SpeechInput {
        override suspend fun listen(languageTag: String): String = "жим 80 на 6"
    }

    private val day = """{"data":{"date":"2026-11-23","exercises":[{"index":0,"name":"Bench Press","metric":"reps","sets":2}],""" +
        """"client":{"id":20,"name":"Ann","today":"2026-11-23"}},"meta":{}}"""

    /** Records every request (path, method, body, If-Match) the view model made, in order. */
    private class Log {
        private val mutex = Mutex()
        private val items = mutableListOf<Triple<String, String, String>>()
        suspend fun add(path: String, body: String, ifMatch: String?) = mutex.withLock { items += Triple(path, body, ifMatch.orEmpty()) }
        suspend fun all(): List<Triple<String, String, String>> = mutex.withLock { items.toList() }
    }

    private fun vm(handler: MockRequestHandler): TrainerClientLogViewModel {
        val client = ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(MockEngine(handler)))
        return TrainerClientLogViewModel(TrainerLogApi(client), PlanApi(client), heard, MediaApi(client), platform, clientId = 20)
    }

    @Test
    fun spokenSetsBecomeAProposalThatOnlyTheTrainerPutsIntoTheForm() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val model = vm { request ->
                when (request.url.encodedPath) {
                    "/api/v2/trainer/voice" -> respond(
                        """{"data":{"kind":"workout","transcript":"жим 80 на 6","reply":"","entries":[{"name":"Bench Press","sets":[{"weight":80,"reps":6}]}]},"meta":{}}""",
                        HttpStatusCode.OK, json,
                    )
                    else -> respond(day, HttpStatusCode.OK, json)
                }
            }
            awaitUntil { model.state.value.day != null }
            model.dictate()
            awaitUntil { model.state.value.voiceText == "жим 80 на 6" }
            model.suggest()
            awaitUntil { model.state.value.proposal != null }
            assertTrue(model.state.value.form[0].rows.all { it == FormSet() }, "nothing is in the form until the trainer taps")
            model.applyWorkout()
            assertEquals(listOf(FormSet("80", "6")), model.state.value.form[0].rows)
            assertEquals("", model.state.value.voiceText)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun planChangesGoToThePlanEditorInOrderForTheClientAndStopAtTheFirstRefusal() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val log = Log()
            var edits = 0
            val model = vm { request ->
                val body = (request.body as? TextContent)?.text.orEmpty()
                log.add(request.url.encodedPath, body, request.headers["If-Match"])
                when {
                    request.url.encodedPath == "/api/v2/trainer/voice" -> respond(
                        """{"data":{"kind":"plan","transcript":"x","reply":"ok","version":"2026-05-01T00:00:00.000Z","actions":[""" +
                            """{"label":"Bench 65","kind":"weight","weekday":1,"index":0,"value":"65","target":"Bench Press"},""" +
                            """{"label":"Remove squat","kind":"delete","weekday":1,"index":1,"target":"Barbell Squat"},""" +
                            """{"label":"Add plank","kind":"add","weekday":1,"exercise":"Plank"}]},"meta":{}}""",
                        HttpStatusCode.OK, json,
                    )
                    request.url.encodedPath == "/api/v2/plan" && request.method == HttpMethod.Post -> {
                        edits++
                        if (edits == 2) respond("""{"error":{"code":"conflict","message":"stale"}}""", HttpStatusCode.Conflict, json)
                        else respond("""{"data":{"ok":true,"version":"2026-05-01T00:00:00.000Z"},"meta":{}}""", HttpStatusCode.OK, json)
                    }
                    else -> respond(day, HttpStatusCode.OK, json)
                }
            }
            awaitUntil { model.state.value.day != null }
            model.onVoiceText("понеділок жим 65, прибери присідання, додай планку")
            model.suggest()
            awaitUntil { model.state.value.proposal != null }
            model.applyPlan()
            awaitUntil { model.state.value.notice != null }

            val planCalls = log.all().filter { it.first == "/api/v2/plan" }
            assertEquals(2, planCalls.size, "the third change is not sent after the second was refused")
            assertTrue(planCalls[0].second.contains("\"action\":\"weight\"") && planCalls[0].second.contains("\"expectName\":\"Bench Press\""))
            assertTrue(planCalls.all { it.second.contains("\"clientId\":20") }, "the client's plan, not the trainer's")
            assertTrue(planCalls.all { it.third == "\"2026-05-01T00:00:00.000Z\"" })
            assertTrue(planCalls[1].second.contains("\"action\":\"del\""))
            assertEquals(TrainerClientLogViewModel.Notice.PlanFailed, model.state.value.notice)
            assertEquals(1, model.state.value.applied)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun aStaleSaveReloadsTheDayInsteadOfOverwritingTheClient() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val log = Log()
            var reloaded = false
            val model = vm { request ->
                val body = (request.body as? TextContent)?.text.orEmpty()
                log.add(request.url.encodedPath, body, null)
                if (request.url.encodedPath == "/api/v2/trainer/log" && request.method == HttpMethod.Post) {
                    respond("""{"error":{"code":"conflict","message":"stale"}}""", HttpStatusCode.Conflict, json)
                } else {
                    if (log.all().any { it.first == "/api/v2/trainer/log" && it.second.isNotEmpty() }) reloaded = true
                    respond(day, HttpStatusCode.OK, json)
                }
            }
            awaitUntil { model.state.value.day != null }
            model.save()
            assertEquals(TrainerClientLogViewModel.Notice.Nothing, model.state.value.notice, "nothing typed: no request")
            model.onCell(0, 0, "weight", "80")
            model.onCell(0, 0, "reps", "6")
            model.save()
            awaitUntil { reloaded }
            assertEquals(TrainerClientLogViewModel.Notice.Stale, model.state.value.notice)
            val saves = log.all().filter { it.first == "/api/v2/trainer/log" && it.second.isNotEmpty() }
            assertEquals(1, saves.size)
            assertTrue(saves[0].second.contains("\"date\":\"2026-11-23\""))
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
