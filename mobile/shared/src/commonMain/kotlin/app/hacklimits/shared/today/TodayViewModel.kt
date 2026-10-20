package app.hacklimits.shared.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.data.DashboardApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class TodayViewModel(private val api: DashboardApi) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Ready(val dashboard: Dashboard) : State
        data class Error(val code: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state

    private var job: Job? = null

    /** Today's recovery-swap card: trades two plan days, then the caller reloads. */
    suspend fun swapDays(weekday: Int, other: Int) = api.swapPlanDays(weekday, other)

    /** Loads the dashboard; while the plan is still being built it checks again every few seconds. */
    fun refresh() {
        job?.cancel()
        job = viewModelScope.launch {
            if (_state.value !is State.Ready) _state.value = State.Loading
            while (true) {
                _state.value = try {
                    State.Ready(api.load())
                } catch (e: ApiException) {
                    State.Error(e.code)
                } catch (e: Exception) {
                    State.Error("network")
                }
                if ((_state.value as? State.Ready)?.dashboard?.viewer?.planPending != true) break
                delay(5_000)
            }
        }
    }
}
