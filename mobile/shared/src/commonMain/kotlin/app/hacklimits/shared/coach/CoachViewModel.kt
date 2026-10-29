package app.hacklimits.shared.coach

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Who a line belongs to. [Routed] is the notice that a client's question went to their trainer. */
enum class CoachRole { User, Coach, Routed }

/**
 * One line of the session. A coach line carries its [actions] (buttons under the answer) and the
 * indexes of those already applied.
 */
data class CoachLine(
    val id: Long,
    val role: CoachRole,
    val text: String,
    val actions: List<CoachAction> = emptyList(),
    val done: Set<Int> = emptySet(),
    /** A card under a coach line: an injury to log, or an urgent symptom. The reply text is never changed. */
    val bodySignal: BodyAlert? = null,
)

data class CoachState(
    val loading: Boolean = true,
    val loadError: String? = null,
    /** A client with a trainer: the screen shows the trainer chat instead of the AI coach. */
    val routed: Boolean = false,
    val trainerName: String = "",
    /** The routed questions still waiting for the trainer. */
    val openQuestions: List<CoachQuestion> = emptyList(),
    val lines: List<CoachLine> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    /** The server's error code for the last failed send; null when there is none to retry. */
    val sendError: String? = null,
    /** "lineId:index" of the action being applied right now. */
    val applying: String? = null,
    val actionError: String? = null,
)

private const val MAX_QUESTION = 500
private const val MAX_LINES = 60
private const val FEEDBACK = "feedback"

@OptIn(ExperimentalUuidApi::class)
class CoachViewModel(private val api: CoachApi, private val telemetry: Telemetry) : ViewModel() {
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
                _state.update {
                    it.copy(
                        loading = false,
                        routed = thread.trainer != null,
                        trainerName = thread.trainer?.name.orEmpty(),
                        openQuestions = thread.questions.filter { q -> q.status != "answered" },
                    )
                }
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
        telemetry.track(if (current.lines.isEmpty()) "app_coach_ask" else "app_coach_followup")
        ask(text, key)
    }

    fun retry() {
        val (text, key) = pending ?: return
        ask(text, key)
    }

    /** Starts a new conversation on this screen. The server keeps nothing of the session. */
    fun clear() = _state.update { it.copy(lines = emptyList(), sendError = null, actionError = null) }

    /**
     * Applies one button under an answer: a plan edit through the plan API, or the feedback to the
     * team. The button stays disabled once it is done.
     */
    fun apply(lineId: Long, index: Int) {
        val s = _state.value
        if (s.applying != null) return
        val line = s.lines.find { it.id == lineId } ?: return
        if (index in line.done) return
        val action = line.actions.getOrNull(index) ?: return
        val edit = if (action.kind == FEEDBACK) null else action.toPlanEdit()
        if (action.kind != FEEDBACK && edit == null) {
            _state.update { it.copy(actionError = "unsupported") }
            return
        }
        val key = Uuid.random().toString()
        viewModelScope.launch {
            _state.update { it.copy(applying = "$lineId:$index", actionError = null) }
            try {
                if (edit == null) api.feedback(action.value.orEmpty(), action.note, key)
                else api.planEdit(edit.action, edit.weekday, edit.index, edit.value, key)
                _state.update { markDone(it, lineId, index) }
                telemetry.track("app_coach_action_${action.kind}")
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(applying = null) }
            }
        }
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
                        else -> withQuestion.append(
                            CoachRole.Coach,
                            plainCoachText(answer.answer.orEmpty()),
                            answer.actions,
                            answer.bodySignal?.toAlert(),
                        )
                    }
                    // Clear the box only if the user did not start typing a new question meanwhile.
                    val input = if (s.input.trim() == text) "" else s.input
                    s.copy(sending = false, lines = lines.takeLast(MAX_LINES), input = input)
                }
            } catch (e: ApiException) {
                _state.update { it.copy(sending = false, sendError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(sending = false, sendError = "network") }
            }
        }
    }
}

/** A plan edit as the plan API takes it. */
internal data class PlanEdit(val action: String, val weekday: Int, val index: Int, val value: String?)

/** The plan edit behind a coach action, or null when the app cannot apply it. Swap and add name an exercise; the rest use the value. */
internal fun CoachAction.toPlanEdit(): PlanEdit? {
    val planAction = planActionFor(kind) ?: return null
    val day = weekday ?: return null
    val payload = if (kind == "swap" || kind == "add") exercise else value
    return PlanEdit(planAction, day, index ?: -1, payload)
}

private fun markDone(s: CoachState, lineId: Long, index: Int): CoachState =
    s.copy(lines = s.lines.map { if (it.id == lineId) it.copy(done = it.done + index) else it })

private fun List<CoachLine>.append(
    role: CoachRole,
    text: String,
    actions: List<CoachAction> = emptyList(),
    bodySignal: BodyAlert? = null,
): List<CoachLine> =
    this + CoachLine(id = (maxOfOrNull { it.id } ?: 0L) + 1L, role = role, text = text, actions = actions, bodySignal = bodySignal)
