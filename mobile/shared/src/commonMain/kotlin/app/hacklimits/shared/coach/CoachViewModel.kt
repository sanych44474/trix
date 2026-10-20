package app.hacklimits.shared.coach

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Who a line belongs to. [Routed] is the notice that a client's question went to their trainer. */
enum class CoachRole { User, Coach, Trainer, Routed }

data class CoachLine(val id: Long, val role: CoachRole, val text: String)

data class CoachState(
    val loading: Boolean = true,
    val loadError: String? = null,
    val lines: List<CoachLine> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    /** The server's error code for the last failed send; null when there is none to retry. */
    val sendError: String? = null,
)

private const val MAX_QUESTION = 500

@OptIn(ExperimentalUuidApi::class)
class CoachViewModel(private val api: CoachApi) : ViewModel() {
    private val _state = MutableStateFlow(CoachState())
    val state: StateFlow<CoachState> = _state

    /** The question that failed to send, with its Idempotency-Key, so Retry is a replay. */
    private var pending: Pair<String, String>? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            try {
                val thread = api.thread()
                _state.update { it.copy(loading = false, lines = threadLines(thread)) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, loadError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = "network") }
            }
        }
    }

    fun onInputChange(text: String) = _state.update { it.copy(input = text.take(MAX_QUESTION), sendError = null) }

    fun send() {
        val current = _state.value
        val text = current.input.trim()
        if (text.isEmpty() || current.sending) return
        val key = pending?.takeIf { it.first == text }?.second ?: Uuid.random().toString()
        pending = text to key
        ask(text, key)
    }

    fun retry() {
        val (text, key) = pending ?: return
        ask(text, key)
    }

    private fun ask(text: String, key: String) {
        // Earlier turns only: the question being asked is sent as `question`, not as history.
        val history = _state.value.lines
            .filter { it.role == CoachRole.User || it.role == CoachRole.Coach }
            .map { CoachHistoryTurn(if (it.role == CoachRole.Coach) "coach" else "user", it.text) }
        viewModelScope.launch {
            _state.update { it.copy(sending = true, sendError = null) }
            try {
                val answer = api.ask(text, history, key)
                pending = null
                _state.update { s ->
                    val withQuestion = s.lines.append(CoachRole.User, text)
                    val lines = when {
                        answer.routed -> withQuestion.append(CoachRole.Routed, "")
                        else -> withQuestion.append(CoachRole.Coach, plainCoachText(answer.answer.orEmpty()))
                    }
                    // Clear the box only if the user did not start typing a new question meanwhile.
                    val input = if (s.input.trim() == text) "" else s.input
                    s.copy(sending = false, lines = lines, input = input)
                }
            } catch (e: ApiException) {
                _state.update { it.copy(sending = false, sendError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(sending = false, sendError = "network") }
            }
        }
    }
}

private fun List<CoachLine>.append(role: CoachRole, text: String): List<CoachLine> =
    this + CoachLine(id = (maxOfOrNull { it.id } ?: 0L) + 1L, role = role, text = text)

/** The routed Q&A in time order. Question timestamps are ISO, message timestamps are SQL style. */
internal fun threadLines(thread: CoachThread): List<CoachLine> {
    val entries = thread.questions.map { it.createdAt to CoachLine(0L, CoachRole.User, plainCoachText(it.text)) } +
        thread.messages.map { m ->
            m.createdAt to CoachLine(0L, if (m.fromMe) CoachRole.User else CoachRole.Trainer, plainCoachText(m.text))
        }
    return entries
        .sortedBy { sortKey(it.first) }
        .mapIndexed { i, entry -> entry.second.copy(id = i + 1L) }
}

private fun sortKey(createdAt: String): String =
    createdAt.replace(' ', 'T').substringBefore('.').removeSuffix("Z")
