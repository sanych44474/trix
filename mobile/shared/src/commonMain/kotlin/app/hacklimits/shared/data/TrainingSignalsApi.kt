package app.hacklimits.shared.data

import io.ktor.client.request.get
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable

/** GET /api/v2/training-signals (packages/contracts/openapi.yaml `TrainingSignals`): advisory lift trends and a deload hint.
 * The server already drops low-confidence lifts. Nothing here changes the plan. */
@Serializable
data class TrainingSignals(
    val exercises: List<LiftSignal> = emptyList(),
    val deload: DeloadHint? = null,
    val computedAt: String? = null,
) {
    /** [status] is "progressing", "stalled" or "regressing". */
    @Serializable data class LiftSignal(val name: String = "", val status: String = "", val confidence: Double = 0.0)
    @Serializable data class DeloadHint(val probability: Double = 0.0, val suggested: Boolean = false)
}

class TrainingSignalsApi(private val api: ApiClient) {
    suspend fun load(): TrainingSignals = api.unwrap(api.http.get("api/v2/training-signals") { api.authorize(this) })

    /** Advisory only: any failure reads as "no signals", so the screen it decorates still loads. */
    suspend fun loadOrNull(): TrainingSignals? = try {
        load()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}
