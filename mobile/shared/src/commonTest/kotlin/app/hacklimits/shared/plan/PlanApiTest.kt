package app.hacklimits.shared.plan

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.PlanEdit
import app.hacklimits.shared.muscles.ExerciseMuscles
import app.hacklimits.shared.muscles.classify
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlanApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun plans(handler: MockRequestHandler): PlanApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return PlanApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    private val planJson = """
        {"data":{
          "owner":{"id":7,"name":"Ana"},"editable":true,"version":"2026-10-01T10:00:00.000Z",
          "days":[{"weekday":1,"name":"Mon","muscleGroup":"Chest","exercises":[
            {"index":0,"name":"Bench Press","sets":"4 × 8","startWeight":"60 kg","metric":"reps","note":"elbows in",
             "ssGroup":"A","wmode":"perSide","videoUrl":"https://youtu.be/x","videoTitle":"Bench"}]}],
          "mesocycle":{"phase":"strength","weekInBlock":2,"blockLength":3},
          "changes":[{"source":"manual","summary":"sets: 3 -> 4","at":"2026-10-01T09:00:00.000Z"}],
          "kit":{"equipment":"dumbbells only","mismatches":2}
        },"meta":{"version":2}}
    """.trimIndent()

    @Test
    fun loadAsksForTheClientsPlanWhenTrainerOpensOne() = runTest {
        var query: String? = null
        val api = plans { request ->
            assertEquals("/api/v2/plan", request.url.encodedPath)
            query = request.url.parameters["clientId"]
            respond(planJson, HttpStatusCode.OK, json)
        }
        api.load(clientId = 42)
        assertEquals("42", query)
    }

    @Test
    fun loadDecodesTheWholePlanPayload() = runTest {
        val api = plans { respond(planJson, HttpStatusCode.OK, json) }
        val plan = api.load()
        assertEquals("Ana", plan.owner?.name)
        assertEquals("2026-10-01T10:00:00.000Z", plan.version)
        val ex = plan.days.single().exercises.single()
        assertEquals("Bench Press", ex.name)
        assertEquals("A", ex.ssGroup)
        assertEquals("perSide", ex.wmode)
        assertEquals("elbows in", ex.note)
        assertEquals("strength", plan.mesocycle?.phase)
        assertEquals(2, plan.mesocycle?.weekInBlock)
        assertEquals(2, plan.kit?.mismatches)
        assertEquals("manual", plan.changes.single().source)
    }

    @Test
    fun anEditCarriesTheVersionAsIfMatchAndOnlyItsOwnFields() = runTest {
        var ifMatch: String? = null
        var key: String? = null
        var body = ""
        val api = plans { request ->
            ifMatch = request.headers["If-Match"]
            key = request.headers["Idempotency-Key"]
            body = (request.body as io.ktor.http.content.TextContent).text
            respond("""{"data":{"ok":true,"version":"v2"},"meta":{}}""", HttpStatusCode.OK, json)
        }
        val result = api.edit(PlanEdit("weight", weekday = 1, index = 0, value = "62.5 kg", expectName = "Bench Press"), "v1")
        assertEquals("\"v1\"", ifMatch)
        assertTrue(!key.isNullOrBlank(), "every write carries an Idempotency-Key")
        assertEquals("""{"action":"weight","weekday":1,"index":0,"value":"62.5 kg","expectName":"Bench Press"}""", body)
        assertEquals("v2", result.version)
        assertNull(result.days)
    }

    @Test
    fun loadRegistersTheLearnedMusclesOfThePlanExercises() = runTest {
        val withLearned = planJson.replace("\"changes\":", "\"learnedMuscles\":[{\"name\":\"Xyzzy Thing\",\"primary\":[\"upper-back\"],\"secondary\":[\"biceps\"]}],\"changes\":")
        val api = plans { respond(withLearned, HttpStatusCode.OK, json) }
        assertEquals(null, classify("Xyzzy Thing"), "unknown until the plan is loaded")
        api.load()
        assertEquals(ExerciseMuscles(listOf("upper-back"), listOf("biceps")), classify("Xyzzy Thing"))
    }

    @Test
    fun catalogSearchDecodesTheItems() = runTest {
        var query: String? = null
        val api = plans { request ->
            query = request.url.parameters["q"]
            respond("""{"data":{"items":[{"id":"bench-press","name":"Bench press","muscle":"chest"}]},"meta":{}}""", HttpStatusCode.OK, json)
        }
        val items = api.search("bench")
        assertEquals("bench", query)
        assertEquals("bench-press", items.single().id)
        assertEquals("chest", items.single().muscle)
    }

    @Test
    fun replanStatusDecodesPendingAndFailed() = runTest {
        val api = plans { respond("""{"data":{"pending":true,"failed":false},"meta":{}}""", HttpStatusCode.OK, json) }
        val status = api.replanStatus()
        assertTrue(status.pending)
        assertTrue(!status.failed)
    }

    @Test
    fun exerciseStepsAreFetchedByLibraryId() = runTest {
        var id: String? = null
        val api = plans { request ->
            id = request.url.parameters["id"]
            respond("""{"data":{"name":"Plank","steps":["Brace","Hold"]},"meta":{}}""", HttpStatusCode.OK, json)
        }
        val steps = api.steps("Plank").steps
        assertEquals("Plank", id)
        assertEquals(listOf("Brace", "Hold"), steps)
    }
}
