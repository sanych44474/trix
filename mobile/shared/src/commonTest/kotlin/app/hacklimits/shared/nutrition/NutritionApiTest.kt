package app.hacklimits.shared.nutrition

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.FoodItem
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.data.NutritionApi
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

class NutritionApiTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun api(handler: MockRequestHandler): NutritionApi =
        NutritionApi(ApiClient("https://api.example.test", InMemorySessionStore("a".repeat(64)), HttpClient(MockEngine(handler))))

    private fun bodyOf(request: io.ktor.client.request.HttpRequestData): String = (request.body as TextContent).text

    @Test
    fun theDayDecodesTotalsTargetsRecentAndTheMealPlan() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/nutrition", request.url.encodedPath)
            respond(
                """{"data":{"date":"2026-10-20","meals":[{"index":0,"desc":"Oats","kcal":300,"protein":10,"fats":5,"carbs":50,"grams":80,"query":null}],
                "totals":{"kcal":300,"protein":10,"fats":5,"carbs":50},"targets":{"calories":2400,"protein":160,"fats":80,"carbs":250},
                "isRestDay":true,"recent":[{"ri":2,"desc":"Banana","kcal":90,"protein":1}],
                "mealPlan":{"days":[{"label":"Mon","meals":[{"name":"Breakfast","items":[{"food":"Oats","grams":80}],"kcal":300,"protein":10,"fats":5,"carbs":50}]}]}},
                "meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val day = api.day()
        assertEquals("Oats", day.meals.single().desc)
        assertEquals(80.0, day.meals.single().grams)
        assertEquals(2400.0, day.targets?.calories)
        assertTrue(day.isRestDay)
        assertEquals("Banana", day.recent.single().desc)
        assertEquals("Oats", day.mealPlan?.days?.single()?.meals?.single()?.items?.single()?.food)
    }

    @Test
    fun aDatabaseSearchPostsTheQueryAndReadsTheItems() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/nutrition", request.url.encodedPath)
            val body = bodyOf(request)
            assertTrue(body.contains("\"action\":\"dbsearch\""), body)
            assertTrue(body.contains("\"q\":\"oat\""), body)
            respond(
                """{"data":{"items":[{"name":"Oats","brand":"Acme","per100":{"kcal":370,"p":13,"f":7,"c":60},"portionG":40}],"source":"trix"},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val items = api.search("oat", "k".repeat(36))
        assertEquals("Acme", items.single().brand)
        assertEquals(40.0, items.single().portionG)
    }

    @Test
    fun aPickedFoodIsAddedWithItsGramsAndPer100Macros() = runTest {
        var body = ""
        val api = api { request ->
            body = bodyOf(request)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        val item = FoodItem("Oats", null, FoodItem.Per100(370.0, 13.0, 7.0, 60.0))
        api.addFromDb(item, 80.0, "k".repeat(36))
        assertTrue(body.contains("\"action\":\"dbadd\""), body)
        assertTrue(body.contains("\"grams\":80"), body)
        assertTrue(body.contains("\"per100\":{\"kcal\":370"), body)
    }

    @Test
    fun aMealScaleSendsItsIndexAndFactor() = runTest {
        var body = ""
        val api = api { request ->
            body = bodyOf(request)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.scale(3, 1.5, "k".repeat(36))
        assertTrue(body.contains("\"action\":\"scale\""), body)
        assertTrue(body.contains("\"index\":3"), body)
        assertTrue(body.contains("\"factor\":1.5"), body)
    }

    @Test
    fun macroCorrectionsCarryAllFourValues() = runTest {
        var body = ""
        val api = api { request ->
            body = bodyOf(request)
            respond("""{"data":{"ok":true},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        api.setMacros(1, 410.0, 22.0, 9.0, 55.0, "k".repeat(36))
        assertTrue(body.contains("\"action\":\"macros\""), body)
        assertTrue(body.contains("\"kcal\":410"), body)
        assertTrue(body.contains("\"carbs\":55"), body)
    }

    @Test
    fun aMealPlanItemEditReturnsTheDaysItChanged() = runTest {
        var body = ""
        val api = api { request ->
            body = bodyOf(request)
            respond(
                """{"data":{"ok":true,"days":[{"label":"Tue","meals":[]}]},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val days = api.planItemScale(0, 1, 2, 0.5, "k".repeat(36))
        assertTrue(body.contains("\"action\":\"mealplan_item_scale\""), body)
        assertTrue(body.contains("\"dayIndex\":0"), body)
        assertTrue(body.contains("\"mealIndex\":1"), body)
        assertTrue(body.contains("\"itemIndex\":2"), body)
        assertEquals("Tue", days.single().label)
    }

    @Test
    fun theGroceryListReadsItsLines() = runTest {
        val api = api { request ->
            assertTrue(bodyOf(request).contains("\"days\":3"))
            respond(
                """{"data":{"days":3,"lines":[{"food":"Oats","grams":240,"category":"grains"}]},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        val lines = api.grocery(3, "k".repeat(36))
        assertEquals("Oats", lines.single().food)
        assertEquals(240.0, lines.single().grams)
    }

    @Test
    fun aGrocerySendWithoutATelegramChatReportsThatCode() = runTest {
        val api = api {
            respond(
                """{"error":{"code":"conflict","message":"no_telegram_chat"}}""",
                HttpStatusCode.Conflict, json,
            )
        }
        assertEquals("no_telegram_chat", assertFailsWith<ApiException> { api.grocerySend(3, "k".repeat(36)) }.code)
    }

    @Test
    fun aFreeTextMealThatCannotBeReadIsNotASuccess() = runTest {
        val api = api { request ->
            assertTrue(bodyOf(request).contains("\"kind\":\"food\""))
            respond("""{"data":{"ok":false,"reason":"unreadable"},"meta":{"version":2}}""", HttpStatusCode.OK, json)
        }
        assertEquals("unreadable", assertFailsWith<ApiException> { api.logText("zzz", "k".repeat(36)) }.code)
    }

    @Test
    fun aFreeTextMealThatIsReadIsLogged() = runTest {
        val api = api { request ->
            assertEquals("/api/v2/log", request.url.encodedPath)
            respond(
                """{"data":{"ok":true,"items":[{"desc":"Banana","kcal":90}],"kcal":90},"meta":{"version":2}}""",
                HttpStatusCode.OK, json,
            )
        }
        api.logText("a banana", "k".repeat(36))
    }
}
