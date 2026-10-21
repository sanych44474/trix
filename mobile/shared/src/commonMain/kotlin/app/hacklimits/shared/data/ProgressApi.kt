package app.hacklimits.shared.data

import app.hacklimits.shared.progress.muscle.LearnedMuscles
import app.hacklimits.shared.progress.muscle.LoggedDay
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The slice of GET /api/v2/dashboard the Progress screen reads (packages/contracts/openapi.yaml
 * `Dashboard`). Unknown fields are ignored. */
@Serializable
data class ProgressDashboard(
    val today: String,
    val lang: String = "uk",
    val sex: String? = null,
    val weight: Weight = Weight(),
    val calendar: Calendar = Calendar(),
    val volume: List<Volume> = emptyList(),
    val exercises: List<Exercise> = emptyList(),
    val measurements: List<Measurement> = emptyList(),
    val macros: Macros = Macros(),
    val bodyFat: BodyFat? = null,
) {
    @Serializable data class Weight(val points: List<Point> = emptyList(), val goal: Double? = null, val projection: Projection? = null) {
        @Serializable data class Point(val date: String, val kg: Double)
        @Serializable data class Projection(val slopePerWeek: Double = 0.0, val onTrack: Boolean = false, val reached: Boolean = false)
    }
    @Serializable data class Calendar(
        val days: List<Day> = emptyList(),
        val split: List<Split> = emptyList(),
        val logs: List<LoggedDay> = emptyList(),
        val learnedMuscles: List<LearnedMuscles> = emptyList(),
    ) {
        @Serializable data class Day(val date: String, @SerialName("s") val status: String)
        @Serializable data class Split(val weekday: Int, val group: String = "", val n: Int = 0)
    }
    /** Weekly working sets per muscle group, against its landmarks. */
    @Serializable data class Volume(val group: String, val sets: Double, val mev: Int, val mav: Int, val zone: String)
    @Serializable data class Exercise(val name: String, val group: String = "", val points: List<E1rmPoint> = emptyList()) {
        @Serializable data class E1rmPoint(val date: String, val e1rm: Double)
    }
    @Serializable data class Measurement(val key: String, val points: List<Point> = emptyList()) {
        @Serializable data class Point(val date: String, val v: Double)
    }
    @Serializable data class Macros(val targets: Targets? = null, val restTargets: Targets? = null, val days: List<Day> = emptyList()) {
        @Serializable data class Targets(val calories: Double, val protein: Double, val fats: Double, val carbs: Double)
        @Serializable data class Day(val date: String, val kcal: Double, val p: Double, val f: Double, val c: Double, val training: Boolean)
    }
    @Serializable data class BodyFat(val date: String, val pct: Double)
}

/** GET /api/v2/records: the personal records (with the e1RM trend for weight x reps lifts) and the badge catalogue. */
@Serializable
data class Records(val records: List<Record> = emptyList(), val badges: List<Badge> = emptyList()) {
    @Serializable data class Record(
        val exercise: String,
        val best: String,
        val metric: String = "reps",
        val updated: String? = null,
        val points: List<Point> = emptyList(),
    ) {
        @Serializable data class Point(val date: String, val v: Double)
    }
    @Serializable data class Badge(val label: String, val earned: Boolean)
}

@Serializable data class PhotoRef(val id: Long, val takenAt: String)
@Serializable private data class ProfilePhotos(val photos: List<PhotoRef> = emptyList())

/** One planned training day from GET /api/v2/plan (only what the body map's picker needs). */
@Serializable data class TrainingPlanDay(
    val weekday: Int,
    val name: String? = null,
    val muscleGroup: String? = null,
    val exercises: List<PlanExercise> = emptyList(),
) {
    @Serializable data class PlanExercise(val name: String)
}
@Serializable private data class PlanPayload(val days: List<TrainingPlanDay> = emptyList())

/** GET /api/v2/workout/today?date=: what was logged on a past day. */
@Serializable data class DayWorkout(val saved: List<SavedExercise> = emptyList()) {
    @Serializable data class SavedExercise(val name: String, val sets: List<JsonElement> = emptyList())
}

class ProgressApi(private val api: ApiClient) {
    suspend fun dashboard(): ProgressDashboard = api.unwrap(api.http.get("api/v2/dashboard") { api.authorize(this) })

    suspend fun records(): Records = api.unwrap(api.http.get("api/v2/records") { api.authorize(this) })

    suspend fun plan(): List<TrainingPlanDay> = api.unwrap<PlanPayload>(api.http.get("api/v2/plan") { api.authorize(this) }).days

    suspend fun dayWorkout(date: String): DayWorkout = api.unwrap(api.http.get("api/v2/workout/today") {
        api.authorize(this)
        parameter("date", date)
    })

    suspend fun photos(): List<PhotoRef> = api.unwrap<ProfilePhotos>(api.http.get("api/v2/profile") { api.authorize(this) }).photos

    /** Where the app loads a progress photo from (sent with the bearer session). */
    fun photoUrl(id: Long): String = api.url("api/v2/photo?id=$id")

    /** Logs a free-text body measurement through the same parser the bot uses ("waist 82, neck 38"). */
    suspend fun logMeasure(text: String, idempotencyKey: String) = log(idempotencyKey, buildJsonObject { put("kind", "measure"); put("text", text) })

    /** Logs today's energy / sleep / stress check-in (1 to 5 each). */
    suspend fun logCheckin(energy: Int, sleep: Int, stress: Int, idempotencyKey: String) = log(idempotencyKey, buildJsonObject {
        put("kind", "checkin"); put("energy", energy); put("sleep", sleep); put("stress", stress)
    })

    private suspend fun log(idempotencyKey: String, body: JsonElement) {
        api.unwrap<JsonElement>(api.http.post("api/v2/log") {
            api.authorize(this)
            header("Idempotency-Key", idempotencyKey)
            contentType(ContentType.Application.Json)
            setBody(body)
        })
    }

    /** /api/v2/photo answers without the { data } envelope, so success is any 2xx. */
    suspend fun uploadPhoto(bytes: ByteArray, mimeType: String) {
        val response = api.http.submitFormWithBinaryData(
            url = "api/v2/photo",
            formData = formData {
                append("photo", bytes, Headers.build {
                    append(HttpHeaders.ContentType, mimeType)
                    append(HttpHeaders.ContentDisposition, "filename=\"progress.jpg\"")
                })
            },
        ) { api.authorize(this) }
        if (!response.status.isSuccess()) throw api.errorOf(response)
    }
}
