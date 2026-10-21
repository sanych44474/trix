package app.hacklimits.shared.progress

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.ProgressApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandler
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ProgressApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun progress(handler: MockRequestHandler): ProgressApi {
        val sessions = InMemorySessionStore("a".repeat(64))
        return ProgressApi(ApiClient("https://api.example.test", sessions, HttpClient(MockEngine(handler))))
    }

    private fun bodyText(request: HttpRequestData): String = when (val body = request.body) {
        is TextContent -> body.text
        is OutgoingContent.ByteArrayContent -> body.bytes().decodeToString()
        else -> ""
    }

    @Test
    fun recordsDecodeTheE1rmTrendAndTheBadgeCatalogue() = runTest {
        val api = progress {
            assertEquals("/api/v2/records", it.url.encodedPath)
            respond(
                """{"data":{"records":[{"exercise":"Squat","best":"100×5","metric":"reps","updated":"2026-10-01",
                    "points":[{"date":"2026-10-01","v":116.7}]}],"badges":[{"label":"First PR","earned":true}]},
                    "meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val records = api.records()
        assertEquals("Squat", records.records.single().exercise)
        assertEquals(116.7, records.records.single().points.single().v)
        assertTrue(records.badges.single().earned)
    }

    @Test
    fun dashboardDecodesTheProgressFieldsAndIgnoresTheRest() = runTest {
        val api = progress {
            respond(
                """{"data":{"viewer":{"id":1,"role":"solo","onboarded":true},"lang":"en","today":"2026-10-20","sex":"female",
                    "weight":{"points":[{"date":"2026-10-19","kg":80.5}],"goal":75,"projection":{"slopePerWeek":-0.3,"onTrack":true,"reached":false}},
                    "calendar":{"days":[{"date":"2026-10-19","s":"done"}],"split":[{"weekday":1,"group":"legs","n":4}],
                        "logs":[{"date":"2026-10-19","done":true,"ex":[{"n":"Squat","s":3}]}],
                        "learnedMuscles":[{"name":"Odd machine","primary":["chest"],"secondary":[]}]},
                    "volume":[{"group":"legs","sets":4.5,"mev":8,"mav":18,"zone":"below"}],
                    "exercises":[{"name":"Squat","group":"legs","points":[{"date":"2026-10-19","e1rm":120.0}]}],
                    "macros":{"targets":{"calories":2400,"protein":160,"fats":70,"carbs":250},"days":[{"date":"2026-10-19","kcal":2300,"p":150,"f":60,"c":240,"training":true}]},
                    "bodyFat":{"date":"2026-10-19","pct":18.2},
                    "somethingNew":{"x":1}},"meta":{"version":2}}""",
                HttpStatusCode.OK,
                json,
            )
        }
        val d = api.dashboard()
        assertEquals("en", d.lang)
        assertEquals("female", d.sex)
        assertEquals(-0.3, d.weight.projection?.slopePerWeek)
        assertEquals("below", d.volume.single().zone)
        assertEquals("Squat", d.calendar.logs.single().ex.single().n)
        assertEquals("Odd machine", d.calendar.learnedMuscles.single().name)
        assertEquals(2400.0, d.macros.targets?.calories)
        assertEquals(18.2, d.bodyFat?.pct)
    }

    @Test
    fun dayWorkoutAsksForTheDateInTheQuery() = runTest {
        val api = progress { request ->
            assertEquals("/api/v2/workout/today", request.url.encodedPath)
            assertEquals("2026-10-18", request.url.parameters["date"])
            respond("""{"data":{"saved":[{"name":"Squat","sets":[{"w":100,"r":5}]}]},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val day = api.dayWorkout("2026-10-18")
        assertEquals(1, day.saved.single().sets.size)
    }

    @Test
    fun logMeasureSendsTheTextWithARetryKey() = runTest {
        var key: String? = null
        var text = ""
        val api = progress { request ->
            key = request.headers["Idempotency-Key"]
            text = bodyText(request)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.logMeasure("waist 82", "k".repeat(36))
        assertEquals("k".repeat(36), key)
        assertTrue(text.contains("\"kind\":\"measure\"") && text.contains("waist 82"), text)
    }

    @Test
    fun logCheckinSendsTheThreeScores() = runTest {
        var text = ""
        val api = progress { request ->
            text = bodyText(request)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.logCheckin(4, 2, 5, "k".repeat(36))
        assertTrue(text.contains("\"kind\":\"checkin\"") && text.contains("\"energy\":4") && text.contains("\"stress\":5"), text)
    }

    @Test
    fun photoUrlCarriesTheIdAndNoSessionSecret() {
        val api = progress { respond("", HttpStatusCode.OK) }
        assertNotNull(api.photoUrl(7))
        assertEquals("https://api.example.test/api/v2/photo?id=7", api.photoUrl(7))
    }
}
