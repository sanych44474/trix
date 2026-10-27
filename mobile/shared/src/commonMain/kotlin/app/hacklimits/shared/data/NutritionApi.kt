package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** GET /api/v2/nutrition (openapi `Nutrition`): one day of Food. */
@Serializable
data class NutritionDay(
    val date: String = "",
    val meals: List<Meal> = emptyList(),
    val totals: Macros = Macros(),
    val targets: Targets? = null,
    val isRestDay: Boolean = false,
    val recent: List<Recent> = emptyList(),
    val mealPlan: MealPlan? = null,
) {
    /** A logged meal; `index` addresses it in edit actions. */
    @Serializable data class Meal(
        val index: Int,
        val desc: String,
        val kcal: Double,
        val protein: Double,
        val fats: Double,
        val carbs: Double,
        val grams: Double? = null,
    )
    @Serializable data class Macros(val kcal: Double = 0.0, val protein: Double = 0.0, val fats: Double = 0.0, val carbs: Double = 0.0)
    @Serializable data class Targets(val calories: Double, val protein: Double, val fats: Double, val carbs: Double)
    @Serializable data class Recent(val ri: Int, val desc: String, val kcal: Double, val protein: Double)
}

/** The generated meal-plan template: days -> meals -> items (openapi `MealPlanDay`). */
@Serializable data class MealPlan(val days: List<MealPlanDay> = emptyList())
@Serializable data class MealPlanDay(val label: String, val meals: List<PlanMeal> = emptyList())
@Serializable data class PlanMeal(val name: String, val items: List<PlanItem> = emptyList())
@Serializable data class PlanItem(val food: String, val grams: Double = 0.0)

@Serializable data class GroceryLine(val food: String, val grams: Double, val category: String = "other")

@Serializable data class FoodItem(val name: String, val brand: String? = null, val per100: Per100, val portionG: Double? = null) {
    @Serializable data class Per100(val kcal: Double, val p: Double, val f: Double, val c: Double)
}

@Serializable private data class FoodSearch(val items: List<FoodItem> = emptyList())
@Serializable private data class PlanDays(val days: List<MealPlanDay> = emptyList())
@Serializable private data class Advice(val text: String = "")
@Serializable private data class GroceryList(val lines: List<GroceryLine> = emptyList())

/** Food actions on POST /api/v2/nutrition (src/webapp/nutritionApi.ts). One action per call, each with
 * its own Idempotency-Key, as the Mini App sends them. */
class NutritionApi(private val api: ApiClient) {
    suspend fun day(): NutritionDay = api.unwrap(api.http.get("api/v2/nutrition") { api.authorize(this) })

    suspend fun search(query: String, key: String): List<FoodItem> =
        api.unwrap<FoodSearch>(post(key, buildJsonObject { put("action", "dbsearch"); put("q", query.take(60)) })).items

    suspend fun barcode(code: String, key: String): List<FoodItem> =
        api.unwrap<FoodSearch>(post(key, buildJsonObject { put("action", "barcode"); put("code", code.take(32)) })).items

    suspend fun addFromDb(item: FoodItem, grams: Double, key: String) = act(key, buildJsonObject {
        put("action", "dbadd"); put("name", item.name.take(80)); item.brand?.let { put("brand", it.take(40)) }; put("grams", grams)
        putJsonObject("per100") { put("kcal", item.per100.kcal); put("p", item.per100.p); put("f", item.per100.f); put("c", item.per100.c) }
    })

    fun addFromDbPayload(item: FoodItem, grams: Double): String = AppJson.encodeToString(JsonElement.serializer(), buildJsonObject {
        put("action", "dbadd"); put("name", item.name.take(80)); item.brand?.let { put("brand", it.take(40)) }; put("grams", grams)
        putJsonObject("per100") { put("kcal", item.per100.kcal); put("p", item.per100.p); put("f", item.per100.f); put("c", item.per100.c) }
    })

    suspend fun readd(ri: Int, key: String) = act(key, buildJsonObject { put("action", "readd"); put("ri", ri) })

    fun readdPayload(ri: Int): String = AppJson.encodeToString(JsonElement.serializer(), buildJsonObject { put("action", "readd"); put("ri", ri) })

    suspend fun performQueued(payload: String, key: String) {
        val body = AppJson.decodeFromString(JsonObject.serializer(), payload)
        act(key, body)
    }

    suspend fun delete(index: Int, key: String) = act(key, buildJsonObject { put("action", "del"); put("index", index) })

    suspend fun scale(index: Int, factor: Double, key: String) = act(key, buildJsonObject { put("action", "scale"); put("index", index); put("factor", factor) })

    suspend fun setGrams(index: Int, grams: Double, key: String) = act(key, buildJsonObject { put("action", "grams"); put("index", index); put("grams", grams) })

    suspend fun setMacros(index: Int, kcal: Double, protein: Double, fats: Double, carbs: Double, key: String) =
        act(key, buildJsonObject { put("action", "macros"); put("index", index); put("kcal", kcal); put("protein", protein); put("fats", fats); put("carbs", carbs) })

    /** Free text ("oatmeal 80 g and a banana"): the server estimates it the same way the bot does. */
    suspend fun logText(text: String, key: String) {
        val result = api.unwrap<JsonElement>(api.http.post("api/v2/log") {
            api.authorize(this)
            aiTimeout()
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("kind", "food"); put("text", text.take(500)) })
        })
        // The server answers 200 with ok:false when it could not read the text; that is not a success.
        if ((result as? JsonObject)?.get("ok") == JsonPrimitive(false)) throw ApiException(200, "unreadable", null)
    }

    suspend fun recipe(key: String): String = api.unwrap<Advice>(post(key, buildJsonObject { put("action", "recipe") })).text
    suspend fun recover(key: String): String = api.unwrap<Advice>(post(key, buildJsonObject { put("action", "recover") })).text

    suspend fun grocery(days: Int, key: String): List<GroceryLine> =
        api.unwrap<GroceryList>(post(key, buildJsonObject { put("action", "grocery"); put("days", days) })).lines

    /** Sends the grocery list to the viewer's Telegram chat (409 no_telegram_chat when there is none). */
    suspend fun grocerySend(days: Int, key: String) = act(key, buildJsonObject { put("action", "grocery_send"); put("days", days) })

    suspend fun regenerateMealPlan(key: String): List<MealPlanDay> =
        api.unwrap<PlanDays>(post(key, buildJsonObject { put("action", "mealplan_regen") })).days

    suspend fun planItemDelete(day: Int, meal: Int, item: Int, key: String): List<MealPlanDay> =
        planItem(key, buildJsonObject { put("action", "mealplan_item_del"); planRef(day, meal, item) })

    suspend fun planItemScale(day: Int, meal: Int, item: Int, factor: Double, key: String): List<MealPlanDay> =
        planItem(key, buildJsonObject { put("action", "mealplan_item_scale"); planRef(day, meal, item); put("factor", factor) })

    suspend fun planItemGrams(day: Int, meal: Int, item: Int, grams: Double, key: String): List<MealPlanDay> =
        planItem(key, buildJsonObject { put("action", "mealplan_item_grams"); planRef(day, meal, item); put("grams", grams) })

    private fun kotlinx.serialization.json.JsonObjectBuilder.planRef(day: Int, meal: Int, item: Int) {
        put("dayIndex", day); put("mealIndex", meal); put("itemIndex", item)
    }

    private suspend fun planItem(key: String, body: JsonObject): List<MealPlanDay> = api.unwrap<PlanDays>(post(key, body)).days

    private suspend fun act(key: String, body: JsonObject) { api.unwrap<JsonElement>(post(key, body)) }

    private suspend fun post(key: String, body: JsonObject) = api.http.post("api/v2/nutrition") {
        api.authorize(this)
        header("Idempotency-Key", key)
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
