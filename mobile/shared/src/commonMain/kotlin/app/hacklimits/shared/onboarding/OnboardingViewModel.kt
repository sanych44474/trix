package app.hacklimits.shared.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.OnboardingAnswers
import app.hacklimits.shared.data.OnboardingApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.TimeZone

/**
 * The questionnaire, in four short steps: goal -> level and equipment -> training days -> about you.
 * Only what the plan generator needs is asked (src/webapp/profileApi.ts requires sex, age, goal,
 * level, training days and equipment); height, weight and the rest are asked later on Today.
 * Each step saves the draft, which is also what the owner funnel counts as "started".
 */
class OnboardingViewModel(private val api: OnboardingApi) : ViewModel() {
    data class State(
        val step: Int = 0,
        val answers: OnboardingAnswers = OnboardingAnswers(),
        val busy: Boolean = false,
        val error: String? = null,
        val submitted: Boolean = false,
    ) {
        val canContinue: Boolean get() = when (step) {
            0 -> answers.goal != null
            1 -> answers.level != null && answers.equipment != null
            2 -> answers.trainingWeekdays.isNotEmpty()
            else -> answers.sex != null && (answers.age ?: 0) in 10..100
        }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun update(change: (OnboardingAnswers) -> OnboardingAnswers) = _state.update { it.copy(answers = change(it.answers), error = null) }

    fun toggleDay(day: Int) = update { a ->
        a.copy(trainingWeekdays = (if (day in a.trainingWeekdays) a.trainingWeekdays - day else a.trainingWeekdays + day).sorted())
    }

    fun back() = _state.update { if (it.step > 0) it.copy(step = it.step - 1, error = null) else it }

    fun next() {
        val s = _state.value
        if (!s.canContinue || s.busy) return
        if (s.step < LAST_STEP) {
            _state.update { it.copy(step = it.step + 1) }
            viewModelScope.launch { runCatching { api.saveDraft(s.answers, answered = s.step + 1, total = LAST_STEP + 1) } }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                api.submit(s.answers.copy(timezone = TimeZone.currentSystemDefault().id))
                _state.update { it.copy(busy = false, submitted = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }

    companion object {
        const val LAST_STEP = 3
        val GOALS = listOf("fat loss", "muscle gain", "recomposition", "strength", "endurance")
        val LEVELS = listOf("beginner", "intermediate", "advanced")
        val EQUIPMENT = listOf("full gym", "home basics (dumbbells, bands)", "dumbbells only", "bodyweight only")
    }
}
