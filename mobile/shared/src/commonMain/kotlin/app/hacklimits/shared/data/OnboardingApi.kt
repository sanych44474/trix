package app.hacklimits.shared.data

import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** The questionnaire body POST /api/v2/onboarding accepts (src/webapp/profileApi.ts). Values are the
 * server's own option ids ("muscle gain", "full gym", ...); labels are translated on the device. */
@Serializable
data class OnboardingAnswers(
    val goal: String? = null,
    val level: String? = null,
    val equipment: String? = null,
    val trainingWeekdays: List<Int> = emptyList(),
    val sex: String? = null,
    val age: Int? = null,
    val heightCm: Int? = null,
    val weightKg: Double? = null,
    val timezone: String? = null,
)

@Serializable private data class Draft(val answers: OnboardingAnswers, val answered: Int, val total: Int)

class OnboardingApi(private val api: ApiClient) {
    suspend fun saveDraft(answers: OnboardingAnswers, answered: Int, total: Int) {
        api.unwrap<kotlinx.serialization.json.JsonElement>(api.http.post("api/v2/onboarding/draft") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(Draft(answers, answered, total))
        })
    }

    /** The plan is then built on the server; Today shows "being built" until it is ready. */
    suspend fun submit(answers: OnboardingAnswers) {
        api.unwrap<kotlinx.serialization.json.JsonElement>(api.http.post("api/v2/onboarding") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(answers)
        })
    }
}
