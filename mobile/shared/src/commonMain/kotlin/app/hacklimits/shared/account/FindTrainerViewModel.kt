package app.hacklimits.shared.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** "Choose a trainer": the approved trainers taking clients. While a request is pending it re-checks
 * every few seconds, and [State.accepted] turns on once the caller is a client. */
class FindTrainerViewModel(private val trainers: TrainerApi) : ViewModel() {
    data class State(
        val directory: TrainerDirectory? = null,
        val loadError: Boolean = false,
        val busyTrainerId: Long? = null,
        val cancelling: Boolean = false,
        val actionError: Boolean = false,
        val accepted: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    private var poll: Job? = null

    init { refresh() }

    fun refresh() {
        viewModelScope.launch { fetch() }
    }

    fun choose(trainerId: Long) {
        if (_state.value.busyTrainerId != null) return
        viewModelScope.launch {
            _state.update { it.copy(busyTrainerId = trainerId, actionError = false) }
            try {
                trainers.requestTrainer(trainerId)
                fetch()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(busyTrainerId = null) }
            }
        }
    }

    fun cancel() {
        viewModelScope.launch {
            _state.update { it.copy(cancelling = true, actionError = false) }
            try {
                trainers.cancelRequest()
                fetch()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(cancelling = false) }
            }
        }
    }

    private suspend fun fetch() {
        try {
            val directory = trainers.directory()
            _state.update { it.copy(directory = directory, loadError = false, accepted = directory.role == "client") }
            if (directory.pending != null) startPolling() else stopPolling()
        } catch (e: Exception) {
            _state.update { it.copy(loadError = true) }
        }
    }

    private fun startPolling() {
        if (poll != null) return
        poll = viewModelScope.launch {
            while (true) {
                delay(POLL_MILLIS)
                fetch()
            }
        }
    }

    private fun stopPolling() {
        poll?.cancel()
        poll = null
    }

    private companion object {
        const val POLL_MILLIS = 6_000L
    }
}
