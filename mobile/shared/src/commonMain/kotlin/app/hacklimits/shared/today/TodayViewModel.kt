package app.hacklimits.shared.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.data.DashboardApi
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

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _state.value = State.Loading
            _state.value = try {
                State.Ready(api.load())
            } catch (e: ApiException) {
                State.Error(e.code)
            } catch (e: Exception) {
                State.Error("network")
            }
        }
    }
}
