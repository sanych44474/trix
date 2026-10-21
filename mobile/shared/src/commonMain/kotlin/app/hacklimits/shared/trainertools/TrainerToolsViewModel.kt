package app.hacklimits.shared.trainertools

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.trainer.clients.ClientRow
import app.hacklimits.shared.trainer.clients.TrainerClientsApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Program sharing: publish a template (library or link), publish my own plan, assign to clients. */
@OptIn(ExperimentalUuidApi::class)
class ProgramSharingViewModel(private val api: TrainerToolsApi, private val clientsApi: TrainerClientsApi) : ViewModel() {
    /** What the last action did, for the screen to phrase. */
    sealed interface Done {
        data class Published(val name: String, val link: String?) : Done
        data class Assigned(val ok: Int, val total: Int) : Done
    }

    data class State(
        val templates: List<ShareTemplate>? = null,
        val clients: List<ClientRow> = emptyList(),
        val templateId: Long? = null,
        val picked: Set<Long> = emptySet(),
        val loading: Boolean = true,
        val loadError: String? = null,
        val busy: Boolean = false,
        val error: String? = null,
        val done: Done? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            try {
                val templates = api.templates()
                val roster = clientsApi.clients()
                _state.update { it.copy(loading = false, templates = templates, clients = roster) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, loadError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = "network") }
            }
        }
    }

    fun pickTemplate(id: Long) = _state.update { it.copy(templateId = id, done = null) }

    fun toggleClient(id: Long) = _state.update {
        it.copy(picked = if (id in it.picked) it.picked - id else it.picked + id, done = null)
    }

    fun publish(library: Boolean) {
        val id = _state.value.templateId ?: return
        act {
            val r = api.publishTemplate(id, library, Uuid.random().toString())
            Done.Published(r.name, r.link)
        }
    }

    fun publishOwnPlan(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        act {
            val r = api.publishOwnPlan(trimmed, Uuid.random().toString())
            Done.Published(r.name, null)
        }
    }

    fun assign() {
        val id = _state.value.templateId ?: return
        val picked = _state.value.picked.toList()
        if (picked.isEmpty()) return
        act {
            val r = api.assign(id, picked, Uuid.random().toString())
            _state.update { it.copy(picked = emptySet()) }
            Done.Assigned(r.assigned, r.total)
        }
    }

    /** One action at a time, as in SocialViewModel. */
    private fun act(block: suspend () -> Done) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, done = null) }
            try {
                val done = block()
                _state.update { it.copy(busy = false, done = done) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }
}

/** The weekly client report. */
class TrainerReportViewModel(private val api: TrainerToolsApi) : ViewModel() {
    data class State(val report: TrainerReport? = null, val loading: Boolean = true, val loadError: String? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            try {
                _state.update { it.copy(loading = false, report = api.report()) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, loadError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = "network") }
            }
        }
    }
}

/** Owner bulk cleanup: the preview count, then an explicit confirm before anything is deleted. */
@OptIn(ExperimentalUuidApi::class)
class OwnerCleanupViewModel(private val api: TrainerToolsApi) : ViewModel() {
    data class State(
        val count: Int? = null,
        val days: Int = 7,
        val confirming: Boolean = false,
        val busy: Boolean = false,
        val deleted: Int? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { preview() }

    fun preview() {
        viewModelScope.launch {
            _state.update { it.copy(error = null, deleted = null, confirming = false) }
            try {
                val p = api.cleanupPreview()
                _state.update { it.copy(count = p.count, days = p.days) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(error = "network") }
            }
        }
    }

    fun askConfirm() = _state.update { it.copy(confirming = true) }

    fun cancelConfirm() = _state.update { it.copy(confirming = false) }

    fun purge() {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                val r = api.cleanupConfirm(Uuid.random().toString())
                _state.update { it.copy(busy = false, confirming = false, count = 0, deleted = r.deleted) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }
}
