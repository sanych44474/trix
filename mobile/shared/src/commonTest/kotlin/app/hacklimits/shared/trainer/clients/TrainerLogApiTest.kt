package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TrainerLogApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler) =
        TrainerLogApi(ApiClient("https://api.example.test", InMemorySessionStore("t".repeat(64)), HttpClient(MockEngine(handler))))

    @Test
    fun theDayIsReadForTheClientAndDate() = runTest {
        val log = api { request ->
            assertEquals("/api/v2/trainer/log", request.url.encodedPath)
            assertEquals("20", request.url.parameters["clientId"])
            assertEquals("2026-11-20", request.url.parameters["date"])
            respond(
                """{"data":{"date":"2026-11-20","exercises":[{"index":0,"name":"Bench Press","metric":"reps","sets":3}],""" +
                    """"savedAt":"2026-11-20T09:00:00.000Z","savedByTrainer":true,"client":{"id":20,"name":"Ann","today":"2026-11-23"},"future":1},"meta":{}}""",
                HttpStatusCode.OK, json,
            )
        }.day(20, "2026-11-20")
        assertEquals("Bench Press", log.exercises.single().name)
        assertEquals("2026-11-20T09:00:00.000Z", log.savedAt)
        assertTrue(log.savedByTrainer)
        assertEquals("2026-11-23", log.client.today)
    }

    @Test
    fun aSaveSendsTheKeyTheEntriesAndTheBaseItWasMadeFrom() = runTest {
        var key: String? = null
        var body = ""
        val saved = api { request ->
            key = request.headers["Idempotency-Key"]
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"prExercises":["Bench Press"],"level":3,"leveledUp":false,"totalWorkouts":12,"volumeKg":960,"savedAt":"2026-11-23T10:00:00.000Z"},"meta":{}}""", HttpStatusCode.OK, json)
        }.save(20, "2026-11-23", listOf(TrainerLogEntry("Bench Press", listOf(TrainerLogSet(80.0, 6)))), "2026-11-23T09:00:00.000Z", "key-1")
        assertEquals("key-1", key)
        assertTrue(body.contains("\"clientId\":20"))
        assertTrue(body.contains("\"baseSavedAt\":\"2026-11-23T09:00:00.000Z\""))
        assertTrue(body.contains("\"weight\":80.0") || body.contains("\"weight\":80"))
        assertEquals(listOf("Bench Press"), saved.prExercises)
        assertEquals("2026-11-23T10:00:00.000Z", saved.savedAt)
    }

    @Test
    fun aStaleSaveIsA409() = runTest {
        val e = assertFailsWith<ApiException> {
            api { respond("""{"error":{"code":"conflict","message":"stale"}}""", HttpStatusCode.Conflict, json) }
                .save(20, "2026-11-23", listOf(TrainerLogEntry("Bench Press", listOf(TrainerLogSet(80.0, 6)))), null, "key-2")
        }
        assertEquals(409, e.status)
    }

    @Test
    fun voiceProposalsOfEachKindParse() = runTest {
        val workout = api { request ->
            assertEquals("/api/v2/trainer/voice", request.url.encodedPath)
            assertTrue((request.body as TextContent).text.contains("\"text\":\"bench 80 by 6\""))
            respond("""{"data":{"kind":"workout","transcript":"bench 80 by 6","reply":"","entries":[{"name":"Bench Press","sets":[{"weight":80,"reps":6}]}]},"meta":{}}""", HttpStatusCode.OK, json)
        }.voice(20, "bench 80 by 6", null, "v-1")
        assertEquals("workout", workout.kind)
        assertEquals(6, workout.entries.single().sets.single().reps)

        val plan = api {
            respond(
                """{"data":{"kind":"plan","transcript":"x","reply":"ok","version":"2026-05-01T00:00:00.000Z",""" +
                    """"actions":[{"label":"Bench 65","kind":"weight","weekday":1,"index":0,"value":"65","target":"Bench Press"}]},"meta":{}}""",
                HttpStatusCode.OK, json,
            )
        }.voice(20, "x", "2026-11-23", "v-2")
        assertEquals("2026-05-01T00:00:00.000Z", plan.version)
        assertEquals("Bench Press", plan.actions.single().target)

        val none = api { respond("""{"data":{"kind":"none","transcript":"x","reply":"Which one?"},"meta":{}}""", HttpStatusCode.OK, json) }.voice(20, "x", null, "v-3")
        assertEquals("Which one?", none.reply)
        assertTrue(none.entries.isEmpty() && none.actions.isEmpty())
    }
}
