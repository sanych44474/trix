package app.hacklimits.shared.workout

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.WorkoutApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class WorkoutApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun workout(handler: MockRequestHandler): WorkoutApi =
        WorkoutApi(ApiClient("https://api.example.test", InMemorySessionStore("a".repeat(64)), HttpClient(MockEngine(handler))))

    private fun data(body: String) = """{"data":$body,"meta":{"version":2}}"""

    @Test
    fun todayCarriesTheSavedLogTheServerDraftAndTheLastSession() = runTest {
        val api = workout { request ->
            assertEquals("/api/v2/workout/today", request.url.encodedPath)
            assertEquals("2026-10-20", request.url.parameters["date"])
            respond(
                data("""{"date":"2026-10-20","weekday":2,"restDay":false,"alreadyLogged":false,"muscleGroup":"legs",
                    "exercises":[{"index":0,"name":"Squat","metric":"reps","sets":3,"reps":5,"weightKg":80,"planSets":"3 × 5",
                    "planWeight":"80 kg","restSec":120,"target":{"w":82.5,"r":5,"lastW":80,"lastR":5,"step":"load"},
                    "last":[{"w":80,"r":5,"sec":0,"m":0}]}],
                    "saved":[{"name":"Squat","rpe":8,"sets":[{"w":80,"r":5,"sec":0,"m":0}]}],
                    "savedAt":"2026-10-20T10:00:00.000Z","durationSec":3000,
                    "draft":{"body":"{}","updatedAt":"2026-10-20T09:00:00.000Z"},"recentDates":["2026-10-18"]}"""),
                HttpStatusCode.OK, json,
            )
        }
        val today = api.today("2026-10-20")
        val squat = today.exercises.single()
        assertEquals(82.5, squat.target?.w)
        assertEquals(120, squat.restSec)
        assertEquals(80.0, squat.last?.single()?.w)
        assertEquals("Squat", today.saved?.single()?.name)
        assertEquals(8.0, today.saved?.single()?.rpe)
        assertEquals("{}", today.draft?.body)
        assertEquals(listOf("2026-10-18"), today.recentDates)
        assertEquals(3000, today.durationSec)
    }

    @Test
    fun saveSendsTheIdempotencyKeyAndPerSetFields() = runTest {
        var key: String? = null
        var body = ""
        val api = workout { request ->
            assertEquals(HttpMethod.Post, request.method)
            assertEquals("/api/v2/workout/save", request.url.encodedPath)
            key = request.headers["Idempotency-Key"]
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond(data("""{"ok":true,"prExercises":["Squat"],"newBadges":[],"level":3,"leveledUp":true,"totalWorkouts":12}"""), HttpStatusCode.OK, json)
        }
        val request = SaveWorkoutRequest(
            entries = listOf(
                SaveWorkoutRequest.Entry(
                    name = "Squat",
                    sets = listOf(SaveWorkoutRequest.SetDone(reps = 5.0, weight = 82.5, rpe = 8.0)),
                    rpe = 8.0,
                    planName = "Back Squat",
                ),
            ),
            date = "2026-10-19",
            durationSec = 2400,
            restTotalSec = 300,
        )
        val result = api.save(request, "k".repeat(36))
        assertEquals("k".repeat(36), key)
        assertTrue(body.contains("\"planName\":\"Back Squat\""), body)
        assertTrue(body.contains("\"rpe\":8.0"), body)
        assertTrue(body.contains("\"date\":\"2026-10-19\""), body)
        assertEquals(listOf("Squat"), result.prExercises)
        assertTrue(result.leveledUp)
    }

    @Test
    fun swapAsksForAlternativesAndPassesTheTypedMuscleAsAQueryParameter() = runTest {
        val api = workout { request ->
            assertEquals("/api/v2/workout/swap", request.url.encodedPath)
            assertEquals("2", request.url.parameters["index"])
            assertEquals("Bench Press", request.url.parameters["name"])
            assertEquals("трицепс", request.url.parameters["muscle"])
            respond(data("""{"alternatives":[{"id":"x1","name":"Dips"}],"muscle":"triceps"}"""), HttpStatusCode.OK, json)
        }
        val swap = api.swap(index = 2, name = "Bench Press", muscle = "трицепс")
        assertEquals("triceps", swap.muscle)
        assertEquals(listOf("Dips"), swap.alternatives.map { it.name })
    }

    @Test
    fun customExerciseSendsItsNameWithAKeyAndReturnsItsVideoAndMuscles() = runTest {
        var key: String? = null
        var body = ""
        val api = workout { request ->
            assertEquals("/api/v2/workout/custom", request.url.encodedPath)
            key = request.headers["Idempotency-Key"]
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond(
                data("""{"name":"Cable Kickback","videoUrl":"https://example.test/v","videoTitle":"How","muscles":{"primary":["triceps"],"secondary":[]}}"""),
                HttpStatusCode.OK, json,
            )
        }
        val result = api.addCustom("Cable Kickback", "c".repeat(36))
        assertEquals("c".repeat(36), key)
        assertEquals("""{"name":"Cable Kickback"}""", body)
        assertEquals(listOf("triceps"), result.muscles?.primary)
        assertEquals("https://example.test/v", result.videoUrl)
    }

    @Test
    fun draftIsPutAsOneOpaqueBodyForTheDateAndDeletedTheSameWay() = runTest {
        val seen = mutableListOf<String>()
        val api = workout { request ->
            seen += "${request.method.value} ${request.url.parameters["date"]}"
            if (request.method == HttpMethod.Put) {
                assertEquals("""{"body":"{\"date\":\"2026-10-20\"}"}""", (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString())
            }
            respond(data("""{"ok":true,"updatedAt":"2026-10-20T09:00:00.000Z"}"""), HttpStatusCode.OK, json)
        }
        api.putDraft("2026-10-20", """{"date":"2026-10-20"}""")
        api.deleteDraft("2026-10-20")
        assertEquals(listOf("PUT 2026-10-20", "DELETE 2026-10-20"), seen)
    }

    @Test
    fun howItWentIsSentAsEasyOkOrHard() = runTest {
        var body = ""
        val api = workout { request ->
            assertEquals("/api/v2/workout/feel", request.url.encodedPath)
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond(data("""{"ok":true,"updated":1}"""), HttpStatusCode.OK, json)
        }
        api.feel("2026-10-20", "hard")
        assertEquals("""{"date":"2026-10-20","feel":"hard"}""", body)
    }

    @Test
    fun pastSessionDecodesIntoTheLoggersCopyShape() = runTest {
        val api = workout { request ->
            assertEquals("2026-10-12", request.url.parameters["date"])
            respond(
                data("""{"exercises":[{"name":"Plank","metric":"time","sets":[{"w":0,"r":0,"sec":45,"m":0}],"rpe":7}]}"""),
                HttpStatusCode.OK, json,
            )
        }
        val copy = api.past("2026-10-12").single()
        assertEquals("time", copy.metric)
        assertEquals(45.0, copy.sets.single().sec)
        assertEquals(7.0, copy.rpe)
    }

    @Test
    fun historyInfoAndStepsDecode() = runTest {
        val api = workout { request ->
            when (request.url.encodedPath) {
                "/api/v2/workout/history" -> respond(data("""{"logs":[{"date":"2026-10-18","title":"Squat, Row","n":2,"durationSec":3100}]}"""), HttpStatusCode.OK, json)
                "/api/v2/workout/exinfo" -> {
                    assertEquals("Cable Kickback", request.url.parameters["name"])
                    respond(data("""{"technique":"Keep elbows still."}"""), HttpStatusCode.OK, json)
                }
                "/api/v2/workout/steps" -> {
                    assertEquals("Barbell_Squat", request.url.parameters["id"])
                    respond(data("""{"steps":["Brace the core","Sit back"],"name":"Присід"}"""), HttpStatusCode.OK, json)
                }
                else -> error("unexpected ${request.url}")
            }
        }
        assertEquals(3100, api.history().single().durationSec)
        assertEquals("Keep elbows still.", api.exerciseInfo("Cable Kickback").technique)
        assertEquals(listOf("Brace the core", "Sit back"), api.steps("Barbell_Squat").steps)
    }

    @Test
    fun restTimerIsStartedAndCancelledOnTheServer() = runTest {
        val seen = mutableListOf<String>()
        var body = ""
        val api = workout { request ->
            seen += "${request.method.value} ${request.url.encodedPath}"
            if (request.method == HttpMethod.Post) body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond(data("""{"ok":true}"""), HttpStatusCode.OK, json)
        }
        api.startRestTimer(90)
        api.cancelRestTimer()
        assertEquals(listOf("POST /api/v2/workout/rest", "DELETE /api/v2/workout/rest"), seen)
        assertEquals("""{"seconds":90}""", body)
    }

    @Test
    fun platesReturnsTheLoadedBarAndTheWarmupRamp() = runTest {
        val api = workout { request ->
            assertEquals("100.0", request.url.parameters["kg"])
            respond(
                data("""{"plan":{"loaded":100.0,"perSide":[20.0,10.0],"leftover":0.0},"ramp":[{"weight":20.0,"reps":8,"pct":0},{"weight":60.0,"reps":5,"pct":40}]}"""),
                HttpStatusCode.OK, json,
            )
        }
        val plates = api.plates(100.0)
        assertEquals(listOf(20.0, 10.0), plates.plan?.perSide)
        assertEquals(60.0, plates.ramp[1].weight)
        assertEquals(40, plates.ramp[1].pct)
    }

    @Test
    fun aPlanSwapIsSentAsAnEditPlanSwapAtIndexMinusOne() = runTest {
        var body = ""
        val api = workout { request ->
            assertEquals("/api/v2/plan", request.url.encodedPath)
            body = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            respond(data("""{"ok":true}"""), HttpStatusCode.OK, json)
        }
        api.swapInPlan(weekday = 2, expectName = "Bench Press", value = "Dips", catalogId = null)
        assertEquals("""{"action":"swap","weekday":2,"index":-1,"expectName":"Bench Press","value":"Dips"}""", body)
    }

    @Test
    fun aRejectedCallSurfacesTheServersCode() = runTest {
        val api = workout {
            respond("""{"error":{"code":"conflict","message":"save in flight"}}""", HttpStatusCode.Conflict, json)
        }
        val error = assertFailsWith<ApiException> { api.save(SaveWorkoutRequest(entries = emptyList()), "k".repeat(36)) }
        assertEquals(409, error.status)
        assertEquals("conflict", error.code)
    }
}
