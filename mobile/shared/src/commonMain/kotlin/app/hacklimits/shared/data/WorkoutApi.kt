package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** GET /api/v2/workout/today (openapi `WorkoutToday`): today's planned exercises with the
 * progression target and last session's sets. */
@Serializable
data class WorkoutToday(
    val date: String,
    val weekday: Int,
    val title: String? = null,
    val restDay: Boolean = false,
    val muscleGroup: String? = null,
    val exercises: List<Exercise> = emptyList(),
) {
    @Serializable
    data class Exercise(
        val index: Int,
        val name: String,
        val metric: String = "reps",
        val sets: Int,
        val reps: Int? = null,
        val weightKg: Double? = null,
        val planSets: String? = null,
        val technique: String? = null,
        val note: String? = null,
        val target: Target? = null,
        val last: List<PastSet> = emptyList(),
        val restSec: Int? = null,
    )

    @Serializable data class Target(val w: Double, val r: Int, val lastW: Double, val lastR: Int, val step: String)
    @Serializable data class PastSet(val w: Double = 0.0, val r: Double = 0.0, val sec: Double = 0.0, val m: Double = 0.0)
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
    data class Entry(val name: String, val sets: List<SetDone>, val rpe: Double? = null)

    @Serializable
    data class SetDone(val reps: Double, val weight: Double, val seconds: Double? = null, val meters: Double? = null)
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

class WorkoutApi(private val api: ApiClient) {
    suspend fun today(): WorkoutToday = api.unwrap(api.http.get("api/v2/workout/today") { api.authorize(this) })

    /** The same [idempotencyKey] on a retry returns the first result instead of saving twice. */
    suspend fun save(request: SaveWorkoutRequest, idempotencyKey: String): SaveWorkoutResult =
        api.unwrap(api.http.post("api/v2/workout/save") {
            api.authorize(this)
            header("Idempotency-Key", idempotencyKey)
            contentType(ContentType.Application.Json)
            setBody(request)
        })
}
