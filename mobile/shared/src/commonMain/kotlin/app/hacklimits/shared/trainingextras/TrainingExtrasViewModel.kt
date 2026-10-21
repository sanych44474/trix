package app.hacklimits.shared.trainingextras

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Failures are the server's error code ("network" when the request never reached it), for errorText. */
private inline fun <T> attempt(block: () -> T): Pair<T?, String?> = try {
    block() to null
} catch (e: ApiException) {
    null to e.code
} catch (e: Exception) {
    null to "network"
}

/** Cardio: the quick log (a type plus the typed time or distance) and the structured sessions. */
@OptIn(ExperimentalUuidApi::class)
class CardioViewModel(private val api: TrainingExtrasApi) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val loadError: String? = null,
        val cardio: Cardio? = null,
        val picked: CardioType? = null,
        val busy: Boolean = false,
        val saved: Boolean = false,
        val unreadable: Boolean = false,
        val actionError: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            val (cardio, error) = attempt { api.cardio() }
            _state.update { it.copy(loading = false, cardio = cardio ?: it.cardio, loadError = error) }
        }
    }

    fun pick(type: CardioType) = _state.update { it.copy(picked = type, saved = false, unreadable = false, actionError = null) }

    fun log(text: String) {
        val type = _state.value.picked ?: return
        if (_state.value.busy || text.isBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, saved = false, unreadable = false, actionError = null) }
            val (ok, error) = attempt { api.logCardio(type.key, text.trim(), Uuid.random().toString()) }
            _state.update {
                when {
                    error != null -> it.copy(busy = false, actionError = error)
                    ok == true -> it.copy(busy = false, picked = null, saved = true)
                    else -> it.copy(busy = false, unreadable = true)
                }
            }
        }
    }
}

/** Strength standards for the Progress screen. */
class StandardsViewModel(private val api: TrainingExtrasApi) : ViewModel() {
    data class State(val loading: Boolean = true, val loadError: String? = null, val standards: Standards? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            val (standards, error) = attempt { api.standards() }
            _state.update { it.copy(loading = false, standards = standards ?: it.standards, loadError = error) }
        }
    }
}

/**
 * The comeback interview. The server's questions drive the steps; the three answers are held here
 * and sent with the decision in one call. [ComebackState.pending] false means there is nothing to show.
 */
@OptIn(ExperimentalUuidApi::class)
class ComebackViewModel(private val api: TrainingExtrasApi) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val loadError: String? = null,
        val pending: Boolean = false,
        val steps: List<ComebackQuestion> = emptyList(),
        val index: Int = 0,
        val answers: Map<String, String> = emptyMap(),
        val busy: Boolean = false,
        val actionError: String? = null,
        val result: ComebackResult? = null,
    ) {
        /** The question on screen; null once all are answered (the decision is sent on its tap). */
        val current: ComebackQuestion? get() = steps.getOrNull(index)
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            val (comeback, error) = attempt { api.comeback() }
            _state.update {
                it.copy(
                    loading = false,
                    loadError = error,
                    pending = comeback?.pending ?: it.pending,
                    steps = comeback?.steps ?: it.steps,
                )
            }
        }
    }

    /** Answers the current question. The decision step sends everything collected so far. */
    fun answer(value: String) {
        val step = _state.value.current ?: return
        if (_state.value.busy) return
        if (step.key == "decision") {
            submit(value)
        } else {
            _state.update { it.copy(answers = it.answers + (step.key to value), index = it.index + 1, actionError = null) }
        }
    }

    private fun submit(decision: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, actionError = null) }
            val (result, error) = attempt { api.answerComeback(_state.value.answers, decision, Uuid.random().toString()) }
            _state.update { it.copy(busy = false, result = result, actionError = error) }
        }
    }
}
