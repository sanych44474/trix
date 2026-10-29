package app.hacklimits.shared.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.canFallbackToCache
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.TrainingSignals
import app.hacklimits.shared.data.TrainingSignalsApi
import app.hacklimits.shared.workout.PendingSaves
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class TodayViewModel(
    private val api: DashboardApi,
    private val cache: AccountCache,
    private val pending: PendingSaves,
    private val signalsApi: TrainingSignalsApi,
) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Ready(
            val dashboard: Dashboard,
            val offline: Boolean = false,
            val lastUpdatedAtMs: Long? = null,
            val pendingSync: Int = 0,
            val needsAttention: Int = 0,
        ) : State
        data class Error(val code: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state

    /** Advisory lift and deload hints; null when none or the call failed. Independent of the dashboard. */
    private val _signals = MutableStateFlow<TrainingSignals?>(null)
    val signals: StateFlow<TrainingSignals?> = _signals

    private var job: Job? = null

    init {
        viewModelScope.launch {
            pending.observeCounts().collect { counts ->
                val current = _state.value as? State.Ready ?: return@collect
                _state.value = current.copy(pendingSync = counts.pending, needsAttention = counts.needsAttention)
            }
        }
    }

    /** Today's recovery-swap card: trades two plan days, then the caller reloads. */
    suspend fun swapDays(weekday: Int, other: Int) = api.swapPlanDays(weekday, other)

    /** Loads the dashboard; while the plan is still being built it checks again every few seconds. */
    fun refresh() {
        job?.cancel()
        viewModelScope.launch { _signals.value = signalsApi.loadOrNull() }
        job = viewModelScope.launch {
            val cached = cachedDashboard()
            if (cached != null) _state.value = State.Ready(cached, offline = true, lastUpdatedAtMs = cache.lastUpdatedAt(CACHE_KEY))
            else if (_state.value !is State.Ready) _state.value = State.Loading
            while (true) {
                _state.value = try {
                    val dashboard = api.load()
                    if (cache.accountId() == dashboard.viewer.id) {
                        cache.write(CACHE_KEY, AppJson.encodeToString(Dashboard.serializer(), dashboard))
                    }
                    State.Ready(dashboard, lastUpdatedAtMs = cache.lastUpdatedAt(CACHE_KEY))
                } catch (e: ApiException) {
                    cachedDashboard().takeIf { e.canFallbackToCache() }?.let {
                        State.Ready(it, offline = true, lastUpdatedAtMs = cache.lastUpdatedAt(CACHE_KEY))
                    }
                        ?: State.Error(e.code)
                } catch (e: Exception) {
                    cachedDashboard()?.let { State.Ready(it, offline = true, lastUpdatedAtMs = cache.lastUpdatedAt(CACHE_KEY)) }
                        ?: State.Error("network")
                }
                if ((_state.value as? State.Ready)?.offline == true) break
                if ((_state.value as? State.Ready)?.dashboard?.viewer?.planPending != true) break
                delay(5_000)
            }
        }
    }

    private suspend fun cachedDashboard(): Dashboard? = runCatching {
        cache.read(CACHE_KEY)?.let { AppJson.decodeFromString(Dashboard.serializer(), it) }
    }.getOrNull()

    private companion object { const val CACHE_KEY = "dashboard.v1" }
}
