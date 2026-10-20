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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** GET /api/v2/nutrition (openapi `Nutrition`). */
@Serializable
data class NutritionDay(
    val date: String,
    val meals: List<Meal> = emptyList(),
    val totals: Macros = Macros(),
    val targets: Targets? = null,
    val isRestDay: Boolean = false,
    val recent: List<Recent> = emptyList(),
) {
    @Serializable data class Meal(val index: Int, val desc: String, val kcal: Double, val protein: Double, val fats: Double, val carbs: Double, val grams: Double? = null)
    @Serializable data class Macros(val kcal: Double = 0.0, val protein: Double = 0.0, val fats: Double = 0.0, val carbs: Double = 0.0)
    @Serializable data class Targets(val calories: Double, val protein: Double, val fats: Double, val carbs: Double)
    @Serializable data class Recent(val ri: Int, val desc: String, val kcal: Double, val protein: Double)
}

@Serializable data class FoodItem(val name: String, val brand: String? = null, val per100: Per100, val portionG: Double? = null) {
    @Serializable data class Per100(val kcal: Double, val p: Double, val f: Double, val c: Double)
}
@Serializable private data class FoodSearch(val items: List<FoodItem> = emptyList())

class NutritionApi(private val api: ApiClient) {
    suspend fun day(): NutritionDay = api.unwrap(api.http.get("api/v2/nutrition") { api.authorize(this) })

    suspend fun delete(index: Int) = act(buildJsonObject { put("action", "del"); put("index", index) })
    suspend fun readd(ri: Int, key: String) = act(buildJsonObject { put("action", "readd"); put("ri", ri) }, key)

    suspend fun search(query: String): List<FoodItem> =
        api.unwrap<FoodSearch>(post(buildJsonObject { put("action", "dbsearch"); put("q", query.take(60)) })).items

    suspend fun addFromDb(item: FoodItem, grams: Double, key: String) = act(buildJsonObject {
        put("action", "dbadd"); put("name", item.name.take(80)); item.brand?.let { put("brand", it.take(40)) }; put("grams", grams)
        putJsonObject("per100") { put("kcal", item.per100.kcal); put("p", item.per100.p); put("f", item.per100.f); put("c", item.per100.c) }
    }, key)

    /** Free text ("oatmeal 80 g and a banana"): the server estimates it the same way the bot does. */
    suspend fun logText(text: String, key: String) {
        api.unwrap<JsonElement>(api.http.post("api/v2/log") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("kind", "food"); put("text", text.take(500)) })
        })
    }

    private suspend fun act(body: JsonObject, key: String? = null) { api.unwrap<JsonElement>(post(body, key)) }

    private suspend fun post(body: JsonObject, key: String? = null) = api.http.post("api/v2/nutrition") {
        api.authorize(this)
        key?.let { header("Idempotency-Key", it) }
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
