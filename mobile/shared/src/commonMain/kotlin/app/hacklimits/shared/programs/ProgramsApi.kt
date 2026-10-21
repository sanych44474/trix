package app.hacklimits.shared.programs

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.plan.newIdempotencyKey
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

// Ready programs: 45 hand-written plans (gym, dumbbells at home, no equipment) for men, women or
// everyone, each at three loads. Applying one adapts it to the person and makes it the active plan.

@Serializable data class ProgramExercise(val name: String, val sets: String = "")
@Serializable data class ProgramDay(val title: String = "", val exercises: List<ProgramExercise> = emptyList())

/** place: gym | dumbbells | bodyweight; audience: men | women | all; level: beginner | intermediate | advanced. */
@Serializable data class ReadyProgram(
    val id: String,
    val place: String,
    val audience: String,
    val level: String,
    val goal: String = "",
    val daysPerWeek: Int = 0,
    val minutes: Int = 0,
    val name: String,
    val summary: String = "",
    val days: List<ProgramDay> = emptyList(),
)

@Serializable data class ReadyProgramsResponse(val role: String = "", val programs: List<ReadyProgram> = emptyList())

/** A program a trainer or another athlete shared through the public library. */
@Serializable data class SharedProgram(val code: String, val name: String, val takenCount: Int = 0)

@Serializable data class SharedProgramsResponse(val role: String = "", val programs: List<SharedProgram> = emptyList())

/** The result of applying a ready program or taking a shared one. */
@Serializable data class ApplyResult(val ok: Boolean = false, val name: String = "", val weekdays: List<Int> = emptyList())

@Serializable private data class ApplyReady(val id: String)
@Serializable private data class TakeShared(val code: String)

class ProgramsApi(private val api: ApiClient) {
    suspend fun list(): ReadyProgramsResponse = api.unwrap(api.http.get("api/v2/programs") { api.authorize(this) })

    /** Replaces the person's plan with the program (403 when a trainer manages their plan). */
    suspend fun apply(id: String): ApplyResult = api.unwrap(api.http.post("api/v2/programs") {
        api.authorize(this)
        header("Idempotency-Key", newIdempotencyKey())
        contentType(ContentType.Application.Json)
        setBody(ApplyReady(id))
    })
}

class SharedProgramsApi(private val api: ApiClient) {
    suspend fun list(): SharedProgramsResponse = api.unwrap(api.http.get("api/v2/library") { api.authorize(this) })

    suspend fun take(code: String): ApplyResult = api.unwrap(api.http.post("api/v2/library") {
        api.authorize(this)
        header("Idempotency-Key", newIdempotencyKey())
        contentType(ContentType.Application.Json)
        setBody(TakeShared(code))
    })
}
