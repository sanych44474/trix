package app.hacklimits.shared.integrations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.TrackingApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Integrations: Health Connect steps (on-device read, posted as a daily log) and Strava (server-side link). */
@OptIn(ExperimentalUuidApi::class)
class IntegrationsViewModel(
    private val stravaApi: StravaApi,
    private val trackingApi: TrackingApi,
    private val healthSync: HealthSync,
) : ViewModel() {
    data class State(
        val strava: StravaStatus? = null,
        val stravaBusy: Boolean = false,
        val stravaOpened: Boolean = false,
        val stravaImported: Int? = null,
        val stravaError: String? = null,
        val healthAvailable: Boolean = false,
        val healthGranted: Boolean = false,
        val healthBusy: Boolean = false,
        val healthSteps: Long? = null,
        val healthNoSteps: Boolean = false,
        val healthError: String? = null,
        /** Apps writing steps to Health Connect, shown when it has none for today; null = not checked. */
        val healthSources: List<String>? = null,
        val sensorAvailable: Boolean = false,
        val sensorGranted: Boolean = false,
        /** The synced count came from the phone's step counter, not Health Connect. */
        val stepsFromSensor: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /**
     * Runs on every resume. The user may have finished the Strava OAuth in the browser, or answered
     * the Health Connect permission dialog, and the screen has no other signal for either.
     */
    fun refresh() {
        viewModelScope.launch {
            val available = runCatching { healthSync.available() }.getOrDefault(false)
            val granted = available && runCatching { healthSync.hasPermission() }.getOrDefault(false)
            _state.update {
                it.copy(
                    healthAvailable = available,
                    healthGranted = granted,
                    sensorAvailable = healthSync.sensorAvailable(),
                    sensorGranted = healthSync.sensorGranted(),
                )
            }
        }
        viewModelScope.launch {
            runCatching { stravaApi.status() }
                .onSuccess { status -> _state.update { it.copy(strava = status, stravaError = null) } }
                .onFailure { e -> _state.update { it.copy(stravaError = errorCodeOf(e)) } }
        }
    }

    fun connectStrava(openInBrowser: (String) -> Unit) = stravaAct {
        openInBrowser(stravaApi.connectUrl())
        _state.update { it.copy(stravaOpened = true) }
    }

    fun syncStrava() = stravaAct {
        val result = stravaApi.sync()
        _state.update { it.copy(stravaImported = result.imported) }
    }

    fun disconnectStrava() = stravaAct {
        stravaApi.disconnect()
        _state.update { it.copy(stravaOpened = false, stravaImported = null) }
    }

    fun syncSteps() {
        // Without either source the screen offers the grant buttons instead, so there is nothing to read.
        val s = _state.value
        if ((!s.healthGranted && !s.sensorGranted) || s.healthBusy) return
        viewModelScope.launch {
            _state.update { it.copy(healthBusy = true, healthError = null, healthSteps = null, healthNoSteps = false, healthSources = null, stepsFromSensor = false) }
            try {
                val fromStore = if (s.healthGranted) healthSync.todaySteps()?.takeIf { it > 0 } else null
                // Health Connect only has what another app wrote there; the phone's counter is the fallback.
                val fromSensor = if (fromStore == null && s.sensorGranted) healthSync.sensorSteps() else null
                val steps = fromStore ?: fromSensor
                if (steps == null) {
                    val sources = if (s.healthGranted) runCatching { healthSync.stepSources() }.getOrDefault(emptyList()) else emptyList()
                    _state.update { it.copy(healthNoSteps = true, healthSources = sources) }
                } else {
                    // Same cap the quick-log card enforces, so both paths accept the same values.
                    val count = steps.coerceIn(0L, MAX_STEPS).toInt()
                    // A fresh key per tap: a retried request is deduplicated, a second tap counts again.
                    trackingApi.steps(count, Uuid.random().toString())
                    _state.update { it.copy(healthSteps = count.toLong(), stepsFromSensor = fromStore == null) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(healthError = errorCodeOf(e)) }
            } finally {
                _state.update { it.copy(healthBusy = false) }
            }
        }
    }

    fun openHealthSettings() = healthSync.openSettings()

    private fun stravaAct(block: suspend () -> Unit) {
        if (_state.value.stravaBusy) return
        viewModelScope.launch {
            _state.update { it.copy(stravaBusy = true, stravaError = null) }
            try {
                block()
                _state.update { it.copy(strava = stravaApi.status()) }
            } catch (e: Exception) {
                _state.update { it.copy(stravaError = errorCodeOf(e)) }
            } finally {
                _state.update { it.copy(stravaBusy = false) }
            }
        }
    }

    /** Server codes pass through to errorText(); anything without one is treated as a connection problem. */
    private fun errorCodeOf(e: Throwable): String = (e as? ApiException)?.code ?: "network"

    private companion object {
        const val MAX_STEPS = 200_000L
    }
}
