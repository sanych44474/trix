package app.hacklimits.shared.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Recovery: the injuries being tracked, and reporting a new one (the Mini App's "Report an injury"). */
class InjuriesViewModel(private val api: InjuriesApi) : ViewModel() {
    data class State(
        val data: InjuryPayload? = null,
        val loading: Boolean = true,
        val loadError: Boolean = false,
        val area: String = "",
        val severity: String = "",
        val busy: Boolean = false,
        val actionError: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = false) }
            try {
                val data = api.load()
                _state.update {
                    it.copy(
                        data = data,
                        loading = false,
                        area = it.area.ifEmpty { data.areas.firstOrNull()?.value.orEmpty() },
                        severity = it.severity.ifEmpty { data.severities.firstOrNull()?.value.orEmpty() },
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = true) }
            }
        }
    }

    fun selectArea(value: String) = _state.update { it.copy(area = value) }

    fun selectSeverity(value: String) = _state.update { it.copy(severity = value) }

    fun dismissActionError() = _state.update { it.copy(actionError = false) }

    fun report() {
        val s = _state.value
        if (s.busy || s.area.isEmpty() || s.severity.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, actionError = false) }
            try {
                api.report(s.area, s.severity)
                load()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
