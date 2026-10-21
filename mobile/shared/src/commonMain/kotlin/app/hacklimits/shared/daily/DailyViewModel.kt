package app.hacklimits.shared.daily

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** The result of the last "easier / harder" tap on one plan day. */
data class DifficultyNote(val weekday: Int, val swapped: Int)

/**
 * State for the four daily-habit cards. One instance serves them all: each card asks for what it
 * shows and the shared state keeps the results. Failures are flags, never thrown into the UI.
 */
data class DailyState(
    val wellbeing: WellbeingPayload? = null,
    val wellbeingError: Boolean = false,
    val survey: List<SurveyItem>? = null,
    val reminderSaving: Boolean = false,
    val reminderError: Boolean = false,
    /** "weekday:up|down" of the difficulty tap in flight. */
    val difficultyBusy: String? = null,
    val difficultyNote: DifficultyNote? = null,
    val difficultyError: Boolean = false,
)

@OptIn(ExperimentalUuidApi::class)
class DailyViewModel(private val api: DailyApi) : ViewModel() {
    private val _state = MutableStateFlow(DailyState())
    val state: StateFlow<DailyState> = _state

    fun loadWellbeing() {
        viewModelScope.launch {
            try {
                val payload = api.wellbeing()
                _state.update { it.copy(wellbeing = payload, wellbeingError = false) }
            } catch (_: Exception) {
                _state.update { it.copy(wellbeingError = true) }
            }
        }
    }

    /** Today's unlogged items; an empty list means the day is complete. Failure leaves the card hidden. */
    fun loadSurvey() {
        viewModelScope.launch {
            try {
                val survey = api.survey().items
                _state.update { it.copy(survey = survey) }
            } catch (_: Exception) {
                _state.update { it.copy(survey = null) }
            }
        }
    }

    fun setReminderHour(hour: Int) {
        if (hour !in 0..23 || _state.value.reminderSaving) return
        viewModelScope.launch {
            _state.update { it.copy(reminderSaving = true, reminderError = false) }
            try {
                api.setReminderHour(hour, Uuid.random().toString())
                _state.update { it.copy(reminderSaving = false) }
            } catch (_: Exception) {
                _state.update { it.copy(reminderSaving = false, reminderError = true) }
            }
        }
    }

    fun stepDifficulty(weekday: Int, up: Boolean) {
        val key = "$weekday:${if (up) "up" else "down"}"
        if (_state.value.difficultyBusy != null) return
        viewModelScope.launch {
            _state.update { it.copy(difficultyBusy = key, difficultyNote = null, difficultyError = false) }
            try {
                val result = api.stepDifficulty(weekday, up, Uuid.random().toString())
                _state.update { it.copy(difficultyBusy = null, difficultyNote = DifficultyNote(weekday, result.swapped)) }
            } catch (_: Exception) {
                _state.update { it.copy(difficultyBusy = null, difficultyError = true) }
            }
        }
    }
}
