package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** GET /api/v2/plan (openapi `Plan`). `version` guards edits: a replan elsewhere makes an edit 409. */
@Serializable
data class Plan(
    val editable: Boolean = true,
    val version: String,
    val days: List<Day> = emptyList(),
    val changes: List<Change> = emptyList(),
) {
    @Serializable data class Day(val weekday: Int, val name: String, val muscleGroup: String = "", val exercises: List<Exercise> = emptyList())
    @Serializable data class Exercise(
        val index: Int,
        val name: String,
        val sets: String,
        val startWeight: String = "",
        val metric: String = "reps",
        val note: String? = null,
        val technique: String? = null,
    )
    @Serializable data class Change(val source: String, val summary: String, val at: String)
}

/** The edit response carries the refreshed days and version; the meso toggle returns only ok. */
@Serializable
data class PlanEditResult(val days: List<Plan.Day>? = null, val version: String? = null, val changes: List<Plan.Change>? = null)

@Serializable data class CatalogExercise(val id: String, val name: String, val muscle: String = "")
@Serializable data class CatalogResult(val items: List<CatalogExercise> = emptyList())

/** One plan edit (POST /api/v2/plan). Only the fields an action needs are sent. */
@Serializable
data class PlanEdit(
    val action: String,
    val weekday: Int,
    val index: Int,
    val value: String? = null,
    val dir: String? = null,
    val catalogId: String? = null,
    val expectName: String? = null,
)

class PlanApi(private val api: ApiClient) {
    suspend fun load(): Plan = api.unwrap(api.http.get("api/v2/plan") { api.authorize(this) })

    suspend fun edit(edit: PlanEdit, version: String): PlanEditResult =
        api.unwrap(api.http.post("api/v2/plan") {
            api.authorize(this)
            header("If-Match", "\"$version\"")
            contentType(ContentType.Application.Json)
            setBody(edit)
        })

    suspend fun search(query: String): List<CatalogExercise> =
        api.unwrap<CatalogResult>(api.http.get("api/v2/plan/catalog") { api.authorize(this); parameter("q", query) }).items
}
