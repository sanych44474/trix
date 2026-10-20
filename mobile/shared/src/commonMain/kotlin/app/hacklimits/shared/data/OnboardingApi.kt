package app.hacklimits.shared.data

import app.hacklimits.shared.onboarding.Answers
import app.hacklimits.shared.plan.newIdempotencyKey
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** The submit body POST /api/v2/onboarding accepts (the Mini App's toRequest). Values are the server's option ids. */
@Serializable
data class OnboardingRequest(
    val sex: String,
    val age: Int,
    val heightCm: Int,
    val weightKg: Double,
    val goal: String,
    val level: String,
    val equipment: String,
    val dietPrefs: String,
    val trainingWeekdays: List<Int>,
    val limitations: String,
    val baselineLifts: String,
    val sessionMinutes: Int,
    val lifestyle: String,
    val sleepSchedule: String,
    val timezone: String? = null,
    /** Trainer clients only: what the trainer may see. */
    val share: Share? = null,
) {
    @Serializable data class Share(val body: Boolean, val health: Boolean)
}

/** The basics a ready program needs before its weights and calorie targets can be set. */
@Serializable data class BasicsRequest(val sex: String, val age: Int, val heightCm: Int, val weightKg: Double)

@Serializable private data class DraftBody(val answers: Answers, val answered: Int, val total: Int)
@Serializable private data class DraftResponse(val answers: Answers? = null)

class OnboardingApi(private val api: ApiClient) {
    /** The questionnaire draft saved on the server (another device may have started it), or null. */
    suspend fun loadDraft(): Answers? = runCatching {
        api.unwrap<DraftResponse>(api.http.get("api/v2/onboarding/draft") { api.authorize(this) }).answers
    }.getOrNull()

    suspend fun saveDraft(answers: Answers, answered: Int, total: Int) {
        api.unwrap<JsonElement>(api.http.post("api/v2/onboarding/draft") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(DraftBody(answers, answered, total))
        })
    }

    /** The plan is then built on the server; Today shows "being built" until it is ready. */
    suspend fun submit(request: OnboardingRequest) {
        api.unwrap<JsonElement>(api.http.post("api/v2/onboarding") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(request)
        })
    }

    /** Stores the body basics on the profile (POST /api/v2/profile), before the ready programs are offered. */
    suspend fun saveBasics(basics: BasicsRequest) {
        api.unwrap<JsonElement>(api.http.post("api/v2/profile") {
            api.authorize(this)
            header("Idempotency-Key", newIdempotencyKey())
            contentType(ContentType.Application.Json)
            setBody(basics)
        })
    }
}
