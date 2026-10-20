package app.hacklimits.shared.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.CatalogExercise
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.PlanEdit
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The training plan and its edits. Every edit is checked against the plan version; when the plan
 * changed elsewhere (a replan, the trainer) the server answers 409 and we reload instead of
 * overwriting someone else's change. */
/** [clientId] is set when a trainer opens a client's plan; null is the person's own plan. */
class PlanViewModel(private val api: PlanApi, private val clientId: Long? = null) : ViewModel() {
    data class State(
        val plan: Plan? = null,
        val loading: Boolean = true,
        val busy: Boolean = false,
        val error: String? = null,
        val reloadedAfterConflict: Boolean = false,
        val search: List<CatalogExercise> = emptyList(),
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var searchJob: Job? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            _state.update {
                try { it.copy(plan = api.load(clientId), loading = false) }
                catch (e: ApiException) { it.copy(loading = false, error = e.code) }
                catch (e: Exception) { it.copy(loading = false, error = "network") }
            }
        }
    }

    fun setSets(weekday: Int, ex: Plan.Exercise, value: String) = apply(PlanEdit("sets", weekday, ex.index, value = value, expectName = ex.name))
    fun setWeight(weekday: Int, ex: Plan.Exercise, value: String) = apply(PlanEdit("weight", weekday, ex.index, value = value, expectName = ex.name))
    fun setNote(weekday: Int, ex: Plan.Exercise, value: String) = apply(PlanEdit("note", weekday, ex.index, value = value, expectName = ex.name))
    fun delete(weekday: Int, ex: Plan.Exercise) = apply(PlanEdit("del", weekday, ex.index, expectName = ex.name))
    fun move(weekday: Int, ex: Plan.Exercise, up: Boolean) = apply(PlanEdit("move", weekday, ex.index, dir = if (up) "up" else "down", expectName = ex.name))
    fun add(weekday: Int, pick: CatalogExercise) = apply(PlanEdit("add", weekday, -1, value = pick.name, catalogId = pick.id))
    fun swap(weekday: Int, ex: Plan.Exercise, pick: CatalogExercise) =
        apply(PlanEdit("swap", weekday, ex.index, value = pick.name, catalogId = pick.id, expectName = ex.name))

    /** Debounced catalog search for add/swap. */
    fun search(query: String) {
        searchJob?.cancel()
        if (query.trim().length < 2) { _state.update { it.copy(search = emptyList()) }; return }
        searchJob = viewModelScope.launch {
            delay(300)
            val items = runCatching { api.search(query.trim()) }.getOrDefault(emptyList())
            _state.update { it.copy(search = items) }
        }
    }

    private fun apply(edit: PlanEdit) {
        val plan = _state.value.plan ?: return
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, reloadedAfterConflict = false) }
            try {
                val result = api.edit(edit.copy(clientId = clientId), plan.version)
                _state.update { s ->
                    s.copy(busy = false, plan = plan.copy(
                        days = result.days ?: plan.days,
                        version = result.version ?: plan.version,
                        changes = result.changes ?: plan.changes,
                    ))
                }
            } catch (e: ApiException) {
                if (e.status == 409 || e.status == 412) {
                    val fresh = runCatching { api.load(clientId) }.getOrNull()
                    _state.update { it.copy(busy = false, plan = fresh ?: it.plan, reloadedAfterConflict = true) }
                } else {
                    _state.update { it.copy(busy = false, error = e.code) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }
}
