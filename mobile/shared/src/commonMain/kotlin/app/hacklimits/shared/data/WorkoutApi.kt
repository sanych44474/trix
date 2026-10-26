package app.hacklimits.shared.data

import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable

/** GET /api/v2/workout/today (openapi `WorkoutToday`): today's planned exercises with the
 * progression target, last session's sets, the saved log and the server copy of the draft. */
@Serializable
data class WorkoutToday(
    val date: String,
    val weekday: Int = 0,
    val title: String? = null,
    val restDay: Boolean = false,
    val alreadyLogged: Boolean = false,
    val muscleGroup: String? = null,
    val exercises: List<Exercise> = emptyList(),
    val saved: List<SavedEntry>? = null,
    val savedAt: String? = null,
    val durationSec: Int? = null,
    val restTotalSec: Int? = null,
    val draft: Draft? = null,
    val recentDates: List<String>? = null,
) {
    @Serializable
    data class Exercise(
        val index: Int,
        val name: String,
        val metric: String = "reps",
        val sets: Int,
        val reps: Double? = null,
        val weightKg: Double? = null,
        val planSets: String? = null,
        val planWeight: String? = null,
        val technique: String? = null,
        val note: String? = null,
        val canonicalName: String? = null,
        val videoUrl: String? = null,
        val videoTitle: String? = null,
        val target: Target? = null,
        val last: List<PastSet>? = null,
        val restSec: Int? = null,
        val ssGroup: String? = null,
        val wmode: String? = null,
    )

    @Serializable data class Target(val w: Double, val r: Double, val lastW: Double, val lastR: Double, val step: String)
    @Serializable data class PastSet(val w: Double = 0.0, val r: Double = 0.0, val sec: Double = 0.0, val m: Double = 0.0)
    @Serializable data class SavedEntry(val name: String, val rpe: Double? = null, val planName: String? = null, val sets: List<PastSet> = emptyList())
    @Serializable data class Draft(val body: String, val updatedAt: String? = null)
}

/** POST /api/v2/workout/save body (openapi `SaveWorkoutRequest`). */
@Serializable
data class SaveWorkoutRequest(
    val entries: List<Entry>,
    val date: String? = null,
    val durationSec: Int? = null,
    val restTotalSec: Int? = null,
) {
    @Serializable
    data class Entry(val name: String, val sets: List<SetDone>, val rpe: Double? = null, val planName: String? = null)

    @Serializable
    data class SetDone(val reps: Double, val weight: Double, val seconds: Double? = null, val meters: Double? = null, val rpe: Double? = null)
}

@Serializable
data class SaveWorkoutResult(
    val ok: Boolean = true,
    val prExercises: List<String> = emptyList(),
    val newBadges: List<String> = emptyList(),
    val level: Int = 0,
    val leveledUp: Boolean = false,
    val totalWorkouts: Int = 0,
)

/** GET /api/v2/workout/past: one finished session, shaped as the logger's copy source. */
@Serializable
data class WorkoutCopyExercise(
    val name: String,
    val metric: String = "reps",
    val sets: List<WorkoutToday.PastSet> = emptyList(),
    val rpe: Double = 0.0,
)

@Serializable data class WorkoutHistoryItem(val date: String, val title: String = "", val n: Int = 0, val durationSec: Int? = null)
@Serializable data class WorkoutHistoryResponse(val logs: List<WorkoutHistoryItem> = emptyList())

@Serializable data class SwapChoice(val id: String = "", val name: String)
@Serializable data class SwapResponse(val alternatives: List<SwapChoice> = emptyList(), val muscle: String? = null)

@Serializable data class CustomExerciseResult(
    val name: String,
    val videoUrl: String? = null,
    val videoTitle: String? = null,
    val muscles: Muscles? = null,
) {
    @Serializable data class Muscles(val primary: List<String> = emptyList(), val secondary: List<String> = emptyList())
}

@Serializable data class ExerciseInfo(val technique: String = "", val videoUrl: String? = null, val videoTitle: String? = null)
@Serializable data class TechniqueSteps(val steps: List<String> = emptyList(), val name: String? = null)

/** GET /api/v2/plates: a barbell plan for a total weight, and the warm-up ramp toward it. */
@Serializable data class PlatesResponse(val plan: PlatePlan? = null, val ramp: List<WarmupSet> = emptyList()) {
    @Serializable data class PlatePlan(val loaded: Double, val perSide: List<Double> = emptyList(), val leftover: Double = 0.0)
    @Serializable data class WarmupSet(val weight: Double, val reps: Int, val pct: Int = 0)
}

class WorkoutApi(private val api: ApiClient) {
    suspend fun today(date: String? = null): WorkoutToday = api.unwrap(api.http.get("api/v2/workout/today") {
        api.authorize(this)
        date?.let { parameter("date", it) }
    })

    /** The same [idempotencyKey] on a retry returns the first result instead of saving twice. */
    suspend fun save(request: SaveWorkoutRequest, idempotencyKey: String): SaveWorkoutResult =
        api.unwrap(api.http.post("api/v2/workout/save") {
            api.authorize(this)
            header("Idempotency-Key", idempotencyKey)
            contentType(ContentType.Application.Json)
            setBody(request)
        })

    suspend fun swap(index: Int, name: String, muscle: String? = null): SwapResponse = api.unwrap(api.http.get("api/v2/workout/swap") {
        api.authorize(this)
        parameter("index", index)
        parameter("name", name)
        muscle?.let { parameter("muscle", it) }
    })

    /** Adds the person's own exercise: the server finds its video and muscles. */
    suspend fun addCustom(name: String, idempotencyKey: String): CustomExerciseResult = api.unwrap(api.http.post("api/v2/workout/custom") {
        api.authorize(this)
        header("Idempotency-Key", idempotencyKey)
        contentType(ContentType.Application.Json)
        setBody(NameBody(name))
    })

    /** Swaps the plan's own exercise for [value] in the saved plan (the "overwrite the plan" choice). */
    suspend fun swapInPlan(weekday: Int, expectName: String, value: String, catalogId: String?) {
        val response = api.http.post("api/v2/plan") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(PlanSwapBody(action = "swap", weekday = weekday, index = -1, expectName = expectName, value = value, catalogId = catalogId))
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }

    /** The unsaved logger, autosaved to the server as one opaque body for [date]. */
    suspend fun putDraft(date: String, body: String) {
        val response = api.http.put("api/v2/workout/draft") {
            api.authorize(this)
            parameter("date", date)
            contentType(ContentType.Application.Json)
            setBody(DraftBody(body))
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }

    suspend fun deleteDraft(date: String) {
        val response = api.http.delete("api/v2/workout/draft") {
            api.authorize(this)
            parameter("date", date)
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }

    /** "How did it go?" after a save: easy | ok | hard, read by next week's progression. */
    suspend fun feel(date: String, feel: String) {
        val response = api.http.post("api/v2/workout/feel") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(FeelBody(date, feel))
        }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }

    suspend fun past(date: String): List<WorkoutCopyExercise> = api.unwrap<PastResponse>(api.http.get("api/v2/workout/past") {
        api.authorize(this)
        parameter("date", date)
    }).exercises

    suspend fun history(): List<WorkoutHistoryItem> = api.unwrap<WorkoutHistoryResponse>(api.http.get("api/v2/workout/history") {
        api.authorize(this)
    }).logs

    suspend fun exerciseInfo(name: String): ExerciseInfo = api.unwrap(api.http.get("api/v2/workout/exinfo") {
        api.authorize(this)
        parameter("name", name)
    })

    suspend fun steps(id: String): TechniqueSteps = api.unwrap(api.http.get("api/v2/workout/steps") {
        api.authorize(this)
        parameter("id", id)
    })


    suspend fun cancelRestTimer() {
        val response = api.http.delete("api/v2/workout/rest") { api.authorize(this) }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }

    suspend fun plates(kg: Double): PlatesResponse = api.unwrap(api.http.get("api/v2/plates") {
        api.authorize(this)
        parameter("kg", kg.toString())
    })

    @Serializable private class PastResponse(val exercises: List<WorkoutCopyExercise> = emptyList())
    @Serializable private class NameBody(val name: String)
    @Serializable private class DraftBody(val body: String)
    @Serializable private class FeelBody(val date: String, val feel: String)
    @Serializable private class PlanSwapBody(
        val action: String,
        val weekday: Int,
        val index: Int,
        val expectName: String,
        val value: String,
        val catalogId: String?,
    )
}
