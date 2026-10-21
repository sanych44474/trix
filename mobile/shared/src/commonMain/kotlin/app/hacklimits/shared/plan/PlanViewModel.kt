package app.hacklimits.shared.plan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.CatalogExercise
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.PlanEdit
import app.hacklimits.shared.data.PlanEditResult
import app.hacklimits.shared.data.ReplanStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The training plan and its edits (the Mini App's PlanView). Every write carries the plan version as
 * If-Match; a 409/412 means the plan changed elsewhere (a replan, the trainer), so the plan is reloaded
 * instead of overwriting someone else's change.
 *
 * [clientId] is set when a trainer opens a client's plan; null is the person's own plan.
 */
class PlanViewModel(private val api: PlanApi, val clientId: Long? = null) : ViewModel() {
    data class State(
        val plan: Plan? = null,
        val loading: Boolean = true,
        /** Error code of a failed load; the editor is replaced by a retry state. */
        val loadError: String? = null,
        /** An edit that failed: "generic" or "last_exercise". Shown inline and dismissable. */
        val actionError: String? = null,
        /** The write in flight ("weekday:index:action", "day:add", "day:del:N", "fitkit", "meso"); blocks other writes. */
        val busy: String? = null,
        /** Key of the last write that succeeded, drives the "plan updated" note. */
        val saved: String? = null,
        /** Catalog search results per search box key. */
        val catalog: Map<String, List<CatalogExercise>> = emptyMap(),
        val catalogBusy: String? = null,
        val replan: ReplanStatus = ReplanStatus(),
        val replanError: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var replanJob: Job? = null

    init {
        load()
        if (clientId == null) refreshReplan()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            try {
                val plan = api.load(clientId)
                _state.update { it.copy(plan = plan, loading = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, loadError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = "network") }
            }
        }
    }

    fun dismissActionError() = _state.update { it.copy(actionError = null) }

    /** A rule the app checks before sending (a day keeps at least one exercise: "last_exercise"). */
    fun showActionError(code: String) = _state.update { it.copy(actionError = code) }

    /** One exercise edit. [onDone] runs after the server accepted it (the sheets close then). */
    fun edit(body: PlanEdit, onDone: () -> Unit = {}) {
        val key = "${body.weekday}:${body.index}:${body.action}"
        write(key, body, onDone = onDone)
    }

    fun setMesocycle(on: Boolean) {
        write("meso", PlanEdit("meso", weekday = 0, index = 0, on = on))
    }

    /** Fits the whole plan to [equipment] (or the current profile equipment when null). */
    fun fitKit(equipment: String?) {
        val current = _state.value.plan?.kit
        write(
            "fitkit",
            PlanEdit("fitkit", weekday = 0, index = 0, equipment = equipment),
            transform = { plan -> if (current != null) plan.copy(kit = Plan.Kit(equipment ?: current.equipment, 0)) else plan },
        )
    }

    fun addDay(weekday: Int, group: String, onDone: () -> Unit = {}) {
        write("day:add", PlanEdit("dayadd", weekday = weekday, index = 0, group = group), onDone = onDone)
    }

    fun removeDay(weekday: Int) {
        write("day:del:$weekday", PlanEdit("daydel", weekday = weekday, index = 0))
    }

    /** Debounced-free catalog search for the swap box; under two characters is ignored (as in the app). */
    fun searchCatalog(key: String, query: String) {
        val q = query.trim()
        if (q.length < 2) return
        viewModelScope.launch {
            _state.update { it.copy(catalogBusy = key) }
            try {
                val items = api.search(q)
                _state.update { it.copy(catalog = it.catalog + (key to items)) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "generic") }
            } finally {
                _state.update { it.copy(catalogBusy = null) }
            }
        }
    }

    fun clearCatalog(key: String) = _state.update { it.copy(catalog = it.catalog - key) }

    /** Technique steps for the library picker's opened exercise; empty when they cannot be loaded. */
    suspend fun steps(id: String): List<String> = runCatching { api.steps(id).steps }.getOrDefault(emptyList())

    fun startReplan() {
        viewModelScope.launch {
            try {
                api.startReplan()
                _state.update { it.copy(replan = ReplanStatus(pending = true), replanError = false) }
                watchReplan()
            } catch (e: ApiException) {
                // 403 = a trainer manages this plan; that is not an error the athlete can fix.
                _state.update { it.copy(replanError = e.status != 403) }
            } catch (e: Exception) {
                _state.update { it.copy(replanError = true) }
            }
        }
    }

    private fun refreshReplan() {
        viewModelScope.launch {
            val status = runCatching { api.replanStatus() }.getOrNull() ?: return@launch
            _state.update { it.copy(replan = status) }
            if (status.pending) watchReplan()
        }
    }

    /** Polls every 4 s while a rebuild runs, then reloads the plan it produced. */
    private fun watchReplan() {
        replanJob?.cancel()
        replanJob = viewModelScope.launch {
            var pending = true
            while (pending) {
                delay(4_000)
                val status = runCatching { api.replanStatus() }.getOrNull() ?: continue
                _state.update { it.copy(replan = status) }
                pending = status.pending
            }
            load()
        }
    }

    private fun write(
        key: String,
        body: PlanEdit,
        transform: (Plan) -> Plan = { it },
        onDone: () -> Unit = {},
    ) {
        val current = _state.value
        val plan = current.plan ?: return
        if (current.busy != null) return
        viewModelScope.launch {
            _state.update { it.copy(busy = key, saved = null, actionError = null) }
            try {
                val result = api.edit(body.copy(clientId = clientId), plan.version)
                _state.update { s -> s.copy(plan = s.plan?.let { transform(it.withResult(result)) }, saved = key) }
                // The meso toggle answers only ok: take the fresh plan from the server.
                if (result.days == null) load()
                onDone()
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = "generic") }
                // A stale version (409/412): the plan changed underneath this copy; fetch the current one.
                if (e.status == 409 || e.status == 412) load()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "generic") }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }

    private fun Plan.withResult(r: PlanEditResult): Plan = copy(
        days = r.days ?: days,
        version = r.version ?: version,
        changes = r.changes ?: changes,
    )
}
