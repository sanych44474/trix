package app.hacklimits.shared.trainer.business

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Trainer business: profile, sessions, finance, plan templates and broadcast. One view model for
 * all five sections so a client list fetched for one section is reused by the others.
 */
class TrainerBusinessViewModel(private val api: TrainerBusinessApi) : ViewModel() {
    enum class Section { PROFILE, SESSIONS, FINANCE, TEMPLATES, BROADCAST }

    /** Confirmations shown in the live region. [BROADCAST_SENT] carries a recipient count. */
    enum class Notice { PROFILE_SAVED, APPLIED, SESSION_ADDED, SESSION_UPDATED, SESSION_DELETED, PAYMENT_RECORDED, PAYMENT_DELETED, TEMPLATE_SAVED, TEMPLATE_ASSIGNED, TEMPLATE_DELETED, BROADCAST_SENT }

    data class State(
        val section: Section = Section.PROFILE,
        val busy: Boolean = false,
        val error: String? = null,
        val notice: Notice? = null,
        val noticeCount: Int = 0,
        val profile: ProfileResult? = null,
        val sessions: SessionsResult? = null,
        val finance: FinanceResult? = null,
        val templates: List<TemplateRow>? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { select(Section.PROFILE) }

    /** Switching section loads its data the first time it is opened. */
    fun select(section: Section) {
        _state.update { it.copy(section = section, error = null, notice = null) }
        val s = _state.value
        when (section) {
            Section.PROFILE -> if (s.profile == null) load { refreshProfile() }
            Section.SESSIONS -> if (s.sessions == null) load { refreshSessions() }
            Section.FINANCE -> if (s.finance == null) load { refreshFinance() }
            // Templates and broadcast both need the client list, which the sessions response carries.
            Section.TEMPLATES -> {
                if (s.templates == null) load { refreshTemplates() }
                if (s.sessions == null) load { refreshSessions() }
            }
            Section.BROADCAST -> if (s.sessions == null) load { refreshSessions() }
        }
    }

    fun saveProfile(patch: ProfilePatch, isNew: Boolean) =
        write(if (isNew) Notice.APPLIED else Notice.PROFILE_SAVED) {
            api.saveProfile(patch, key())
            refreshProfile()
            0
        }

    /** [startsAtIso] is already validated by the screen (see parseLocalStart). */
    fun addSession(clientId: Int, startsAtIso: String, durationMin: Int, price: Int?, note: String) =
        write(Notice.SESSION_ADDED) {
            api.sessionAction(
                SessionAction("create", clientId = clientId, startsAt = startsAtIso, durationMin = durationMin, price = price, note = note.ifBlank { null }),
                key(),
            )
            refreshSessions()
            0
        }

    fun setSessionStatus(id: Int, status: String) = write(Notice.SESSION_UPDATED) {
        api.sessionAction(SessionAction("status", id = id, status = status), key())
        refreshSessions()
        0
    }

    fun deleteSession(id: Int) = write(Notice.SESSION_DELETED) {
        api.sessionAction(SessionAction("delete", id = id), key())
        refreshSessions()
        0
    }

    fun recordPayment(clientId: Int, amount: Int, note: String) = write(Notice.PAYMENT_RECORDED) {
        api.financeAction(FinanceAction("pay", clientId = clientId, amount = amount, note = note.ifBlank { null }), key())
        refreshFinance()
        0
    }

    fun deletePayment(id: Int) = write(Notice.PAYMENT_DELETED) {
        api.financeAction(FinanceAction("delete", id = id), key())
        refreshFinance()
        0
    }

    fun createTemplate(name: String, fromClientId: Int) = write(Notice.TEMPLATE_SAVED) {
        api.templateAction(TemplateAction("create", name = name, fromClientId = fromClientId), key())
        refreshTemplates()
        0
    }

    fun assignTemplate(templateId: Int, clientId: Int) = write(Notice.TEMPLATE_ASSIGNED) {
        api.templateAction(TemplateAction("assign", id = templateId, clientId = clientId), key())
        0
    }

    fun deleteTemplate(id: Int) = write(Notice.TEMPLATE_DELETED) {
        api.templateAction(TemplateAction("delete", id = id), key())
        refreshTemplates()
        0
    }

    /** The server counts the recipients and returns that count; the notice reports it. */
    fun broadcast(text: String) = write(Notice.BROADCAST_SENT) {
        api.broadcast(text, key()).sent
    }

    private suspend fun refreshProfile() {
        val profile = api.profile()
        _state.update { it.copy(profile = profile) }
    }

    private suspend fun refreshSessions() {
        val sessions = api.sessions()
        _state.update { it.copy(sessions = sessions) }
    }

    private suspend fun refreshFinance() {
        val finance = api.finance()
        _state.update { it.copy(finance = finance) }
    }

    private suspend fun refreshTemplates() {
        val templates = api.templates()
        _state.update { it.copy(templates = templates) }
    }

    /** Writes are not queued: a second tap while one is in flight is dropped. */
    private fun write(notice: Notice, block: suspend () -> Int) {
        if (_state.value.busy) return
        perform(notice, block)
    }

    private fun perform(notice: Notice? = null, block: suspend () -> Int) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val count = block()
                _state.update { it.copy(busy = false, notice = notice, noticeCount = count) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }

    /** Reads report failures through the same state as writes, so both go through [perform]. */
    private fun load(block: suspend () -> Unit) = perform(null) { block(); 0 }

    @OptIn(ExperimentalUuidApi::class)
    private fun key() = Uuid.random().toString()
}
