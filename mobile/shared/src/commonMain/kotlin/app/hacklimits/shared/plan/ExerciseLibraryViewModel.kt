package app.hacklimits.shared.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.PlanEdit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The exercise library screen (More -> library): browse, and add an exercise to a day of your own plan. */
class ExerciseLibraryViewModel(private val plans: PlanApi) : ViewModel() {
    data class State(
        val plan: Plan? = null,
        val planLoaded: Boolean = false,
        /** Weekday the next "add" goes to (the first training day by default). */
        val day: Int? = null,
        /** Exercise ids added in this session, so their button reads "added". */
        val added: Set<String> = emptySet(),
        val adding: String? = null,
        val error: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        viewModelScope.launch {
            val plan = runCatching { plans.load() }.getOrNull()
            _state.update { it.copy(plan = plan, planLoaded = true, day = plan?.days?.firstOrNull()?.weekday) }
        }
    }

    fun selectDay(weekday: Int) = _state.update { it.copy(day = weekday) }

    /** Adds the exercise to the chosen day under its library name, keeping the English one as canonical. */
    fun add(entry: LibraryEntry, name: String) {
        val s = _state.value
        val plan = s.plan ?: return
        val day = s.day ?: return
        if (s.adding != null) return
        viewModelScope.launch {
            _state.update { it.copy(adding = entry.id, error = false) }
            try {
                plans.edit(PlanEdit("add", weekday = day, index = -1, value = name, freeExerciseId = entry.id), plan.version)
                _state.update { it.copy(added = it.added + entry.id) }
            } catch (e: Exception) {
                _state.update { it.copy(error = true) }
            } finally {
                _state.update { it.copy(adding = null) }
            }
        }
    }

    suspend fun steps(id: String): List<String> = runCatching { plans.steps(id).steps }.getOrDefault(emptyList())
}
