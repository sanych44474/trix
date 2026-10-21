package app.hacklimits.shared.data

import app.hacklimits.shared.plan.newIdempotencyKey
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** GET /api/v2/plan (the Mini App's Plan payload). `version` guards edits: a replan elsewhere makes an edit 409. */
@Serializable
data class Plan(
    val owner: Owner? = null,
    val editable: Boolean = true,
    val version: String,
    val days: List<Day> = emptyList(),
    val mesocycle: Mesocycle? = null,
    val changes: List<Change> = emptyList(),
    val kit: Kit? = null,
) {
    @Serializable data class Owner(val id: Long = 0, val name: String = "")
    @Serializable data class Day(val weekday: Int, val name: String = "", val muscleGroup: String = "", val exercises: List<Exercise> = emptyList())
    @Serializable data class Exercise(
        val index: Int,
        val name: String,
        val sets: String,
        val startWeight: String = "",
        val metric: String = "reps",
        val technique: String? = null,
        val note: String? = null,
        val videoUrl: String? = null,
        val videoTitle: String? = null,
        /** Superset group letter; exercises sharing it are done back to back. */
        val ssGroup: String? = null,
        val wmode: String? = null,
    )
    @Serializable data class Mesocycle(val phase: String, val weekInBlock: Int = 1, val blockLength: Int = 1)
    @Serializable data class Change(val source: String, val summary: String, val at: String)
    /** The owner's equipment and how many plan exercises need gear outside it. */
    @Serializable data class Kit(val equipment: String = "", val mismatches: Int = 0)
}

/** The edit response carries the refreshed days, version and log; the meso toggle returns only ok. */
@Serializable
data class PlanEditResult(
    val ok: Boolean? = null,
    val days: List<Plan.Day>? = null,
    val version: String? = null,
    val changes: List<Plan.Change>? = null,
)

@Serializable data class CatalogExercise(val id: String, val name: String, val muscle: String = "")
@Serializable data class CatalogResult(val items: List<CatalogExercise> = emptyList())

@Serializable data class ReplanStatus(val pending: Boolean = false, val failed: Boolean = false)

@Serializable data class ExerciseSteps(val steps: List<String> = emptyList(), val name: String = "")

/**
 * One plan edit (POST /api/v2/plan). Only the fields an action needs are sent; AppJson drops nulls
 * and defaults. `index` has no default, so "add" still sends -1.
 */
@Serializable
data class PlanEdit(
    val action: String,
    val weekday: Int,
    val index: Int,
    val value: String? = null,
    val dir: String? = null,
    val catalogId: String? = null,
    val freeExerciseId: String? = null,
    val expectName: String? = null,
    /** A trainer editing a client's plan. */
    val clientId: Long? = null,
    /** action=dayadd: the muscle-group template (chest, back, legs, shoulders, arms, full, core). */
    val group: String? = null,
    /** action=dayswap: the plan day that trades weekdays with [weekday]. */
    val other: Int? = null,
    /** action=fitkit: change the profile equipment first. */
    val equipment: String? = null,
    /** action=meso: start (true) or stop (false) periodization. */
    val on: Boolean? = null,
)

class PlanApi(private val api: ApiClient) {
    suspend fun load(clientId: Long? = null): Plan =
        api.unwrap(api.http.get("api/v2/plan") { api.authorize(this); clientId?.let { parameter("clientId", it) } })

    suspend fun edit(edit: PlanEdit, version: String): PlanEditResult =
        api.unwrap(api.http.post("api/v2/plan") {
            api.authorize(this)
            header("If-Match", "\"$version\"")
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(edit)
        })

    suspend fun search(query: String): List<CatalogExercise> =
        api.unwrap<CatalogResult>(api.http.get("api/v2/plan/catalog") { api.authorize(this); parameter("q", query) }).items

    suspend fun replanStatus(): ReplanStatus =
        api.unwrap(api.http.get("api/v2/plan/replan") { api.authorize(this) })

    /** Short technique steps of a library exercise (GET /api/v2/workout/steps, translated server-side once). */
    suspend fun steps(id: String): ExerciseSteps =
        api.unwrap(api.http.get("api/v2/workout/steps") { api.authorize(this); parameter("id", id) })

    /** Starts a rebuild from the athlete's current profile; the server builds it in the background. */
    suspend fun startReplan() {
        api.unwrap<kotlinx.serialization.json.JsonElement>(api.http.post("api/v2/plan/replan") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
        })
    }
}
