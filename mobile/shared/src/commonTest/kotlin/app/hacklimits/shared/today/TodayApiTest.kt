package app.hacklimits.shared.today

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.TrackingApi
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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TodayApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val token = "a".repeat(64)

    private fun client(handler: MockRequestHandler): ApiClient =
        ApiClient("https://api.example.test", InMemorySessionStore(token), HttpClient(MockEngine(handler)))

    @Test
    fun theDashboardDecodesEveryFieldTodayReads() = runTest {
        val api = DashboardApi(client { request ->
            assertEquals("/api/v2/dashboard", request.url.encodedPath)
            assertEquals("Bearer $token", request.headers[HttpHeaders.Authorization])
            respond(DASHBOARD, HttpStatusCode.OK, json)
        })
        val d = api.load()

        assertEquals("Ann", d.name)
        assertEquals(listOf("sex", "dietPrefs"), d.viewer.profileGaps)
        assertEquals("Bench press", d.logForm?.exercises?.first())
        assertEquals(45, d.logForm?.minutes)
        assertEquals("volume_above", d.recovery.factors.first().code)
        assertEquals(2, d.recovery.factors.first().count)
        assertEquals(1500.0, d.todayStats?.waterMl)
        assertEquals(8000, d.todayStats?.stepsGoal)
        assertEquals("chest", d.recoverySwap?.tired?.first())
        assertEquals(4, d.week?.balanceGoal)
        assertEquals("workouts", d.week?.quests?.first()?.kind)
        assertEquals("1.0", d.whatsnew?.version)
        assertEquals(2.0, d.macros.targets?.fats)
        assertEquals(1, d.macros.days.size)
        assertEquals(1, d.exercises.size)
        assertEquals("pull-up", d.badges.first().code)
        assertEquals(2, d.calendar.logs.first().ex.size)
        assertFalse(d.calendar.logs.first().done)
    }

    @Test
    fun theWeekCardDecodesAndIsFetchedWithTheSession() = runTest {
        val api = DashboardApi(client { request ->
            assertEquals("/api/v2/weekcard", request.url.encodedPath)
            respond(
                """{"data":{"card":"text","name":"Ann","stats":{"since":"2026-10-12","until":"2026-10-18","done":2,"planned":3,"totalSets":24,"volumeKg":5120.5,"prs":1,"streak":2,"level":4,"xp":310}},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        })
        val card = api.weekCard()
        assertEquals("text", card.card)
        assertEquals(2, card.stats?.done)
        assertEquals(5120.5, card.stats?.volumeKg)
    }

    @Test
    fun theWeekCardWithoutStatsIsAnEmptyWeek() = runTest {
        val api = DashboardApi(client { respond("""{"data":{"card":null,"stats":null,"name":"Ann"},"meta":{"version":2}}""", HttpStatusCode.OK, json) })
        val card = api.weekCard()
        assertNull(card.card)
        assertNull(card.stats)
    }

    @Test
    fun aRecoverySwapPostsTheDayswapActionWithAKey() = runTest {
        var key: String? = null
        var body = ""
        val api = DashboardApi(client { request ->
            assertEquals("/api/v2/plan", request.url.encodedPath)
            key = request.headers["Idempotency-Key"]
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        })
        api.swapPlanDays(1, 3)
        assertTrue(body.contains("\"action\":\"dayswap\""), body)
        assertTrue(body.contains("\"weekday\":1"), body)
        assertTrue(body.contains("\"other\":3"), body)
        assertTrue(!key.isNullOrBlank())
    }

    @Test
    fun waterIsLoggedAsAWaterKindWithItsOwnKey() = runTest {
        var body = ""
        val api = TrackingApi(client { request ->
            assertEquals("/api/v2/log", request.url.encodedPath)
            assertEquals("k".repeat(36), request.headers["Idempotency-Key"])
            body = (request.body as TextContent).text
            respond("""{"data":{"ok":true,"ml":1750},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        })
        api.water(250, "k".repeat(36))
        assertTrue(body.contains("\"kind\":\"water\""), body)
        assertTrue(body.contains("\"ml\":250"), body)
        assertFalse(body.contains("steps"), body)
    }

    private companion object {
        val DASHBOARD = """
        {
          "data": {
            "viewer": {"id": 7, "role": "solo", "onboarded": true, "planPending": false, "profileGaps": ["sex", "dietPrefs"]},
            "lang": "en",
            "today": "2026-10-20",
            "name": "Ann",
            "weight": {"points": [{"date": "2026-10-13", "kg": 80.0}], "goal": 75.0, "projection": {"slopePerWeek": -0.4, "onTrack": true, "reached": false}},
            "calendar": {
              "days": [{"date": "2026-10-19", "s": "done"}, {"date": "2026-10-20", "s": "rest"}],
              "split": [{"weekday": 1, "group": "push", "n": 4}, {"weekday": 3, "group": "legs", "n": 4}],
              "logs": [{"date": "2026-10-20", "done": false, "ex": [{"n": "Bench press", "s": 3}, {"n": "Row", "s": 2}]}],
              "learnedMuscles": []
            },
            "whatsnew": {"version": "1.0", "text": "*New* stuff"},
            "recoverySwap": {"weekday": 1, "other": 3, "todayGroup": "push", "otherGroup": "legs", "tired": ["chest"], "because": ["bench"]},
            "week": {
              "weekStart": "2026-10-19", "balance": 72, "balanceStreak": 2, "balanceGoal": 4, "questXp": 40,
              "quests": [{"code": "q1", "kind": "workouts", "target": 3, "current": 1, "done": false}]
            },
            "badges": [{"code": "pull-up", "label": "Pull-up"}],
            "volume": [],
            "conditioning": {"sessions": 0, "minutes": 0, "meters": 0, "zone": "below"},
            "recovery": {"score": 62, "label": "fair", "factors": [{"code": "volume_above", "count": 2}]},
            "exercises": [{"name": "Squat", "group": "legs", "points": [{"date": "2026-10-14", "e1rm": 120.0}]}],
            "macros": {"targets": {"calories": 2400, "protein": 160, "fats": 2.0, "carbs": 250}, "days": [{"date": "2026-10-19", "kcal": 2200, "p": 150, "f": 70, "c": 240, "training": true}]},
            "todayStats": {"waterMl": 1500, "waterGoal": 2500, "steps": 4200, "stepsGoal": 8000},
            "logForm": {"exercises": ["Bench press", "Row"], "minutes": 45},
            "gamification": {"level": 3, "xp": 300, "intoLevel": 50, "needed": 200}
          },
          "meta": {"version": 2}
        }
        """.trimIndent()
    }
}
