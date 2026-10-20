package app.hacklimits.shared.trainer.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Confirmations the screen shows under the panel that produced them. */
enum class Notice { CardSaved, NoteSaved, PhotoRequested, NudgeSent, DraftDone, TemplateCreated }

/**
 * The trainer's clients: the pulse list with requests, questions, invite link and first-client
 * checklist, the at-risk report, and one open client card. Each action sends a fresh
 * Idempotency-Key. A failed list load is a retryable error; a failed action is a dismissible note.
 */
@OptIn(ExperimentalUuidApi::class)
class TrainerClientsViewModel(private val api: TrainerClientsApi) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val loadFailed: Boolean = false,
        /** Key of the action in flight (buttons on that panel are disabled while set). */
        val busy: String? = null,
        val actionError: Boolean = false,
        /** Create-template failed because the client has no active plan to save. */
        val templateNoPlan: Boolean = false,
        val notice: Notice? = null,
        /** Clients with unread chat messages first, then the dashboard's own order. */
        val clients: List<ClientRow> = emptyList(),
        val unread: Map<Long, Int> = emptyMap(),
        val requests: List<TrainerRequest> = emptyList(),
        val questions: List<TrainerQuestion> = emptyList(),
        val invite: TrainerInvite? = null,
        val freshInvite: ProspectInvite? = null,
        /** The first-client checklist is hidden for this session (the Mini App remembers this on the device). */
        val checklistHidden: Boolean = false,
        val showAtRisk: Boolean = false,
        val cardId: Long? = null,
        val card: ClientCard? = null,
        val cardLoading: Boolean = false,
        val cardFailed: Boolean = false,
        val photoBearer: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    /** Reloads the list, requests, questions, unread counts and invite. Also used after an action. */
    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loadFailed = false) }
            coroutineScope {
                // The client list is required; the other panels fail on their own, as in the Mini App.
                val clients = async { runCatching { api.clients() } }
                val unread = async { runCatching { api.chatUnread() } }
                val requests = async { runCatching { api.requests() } }
                val questions = async { runCatching { api.questions() } }
                val invite = async { runCatching { api.invite() } }
                val clientsResult = clients.await()
                val unreadResult = unread.await()
                val requestsResult = requests.await()
                val questionsResult = questions.await()
                val inviteResult = invite.await()
                if (clientsResult.isFailure) {
                    _state.update { it.copy(loading = false, loadFailed = true) }
                    return@coroutineScope
                }
                val unreadMap = unreadResult.getOrDefault(emptyMap())
                val sorted = clientsResult.getOrThrow().sortedByDescending { (unreadMap[it.id] ?: 0) > 0 }
                val partFailed = requestsResult.isFailure || questionsResult.isFailure
                _state.update {
                    it.copy(
                        loading = false,
                        clients = sorted,
                        unread = unreadMap,
                        requests = requestsResult.getOrDefault(it.requests),
                        questions = questionsResult.getOrDefault(it.questions),
                        invite = inviteResult.getOrNull(),
                        actionError = it.actionError || partFailed,
                    )
                }
            }
        }
    }

    fun dismissError() = _state.update { it.copy(actionError = false, templateNoPlan = false) }

    fun resolveRequest(request: TrainerRequest, accept: Boolean) = act("req:${request.id}") {
        api.resolveRequest(request.id, accept, key())
        load()
    }

    fun answer(question: TrainerQuestion, text: String) = act("answer:${question.id}") {
        api.answer(question.id, text, key())
        load()
    }

    fun hideChecklist() = _state.update { it.copy(checklistHidden = true) }

    fun showAtRisk(show: Boolean) = _state.update { it.copy(showAtRisk = show) }

    fun openCard(clientId: Long) {
        _state.update { it.copy(cardId = clientId, card = null, cardLoading = true, cardFailed = false, notice = null, actionError = false, templateNoPlan = false) }
        viewModelScope.launch {
            val bearer = api.bearer()
            loadCard(clientId, bearer)
        }
    }

    fun closeCard() = _state.update { it.copy(cardId = null, card = null, cardLoading = false, cardFailed = false, notice = null, actionError = false, templateNoPlan = false, photoBearer = null) }

    /** Retries the open card after a failed load. */
    fun retryCard() = _state.value.cardId?.let { openCard(it) }

    fun photoUrl(id: Long): String = api.photoUrl(id)

    fun decideDraft(decision: String) = withCard("draft") { id ->
        api.decideDraft(id, decision, key())
        _state.update { it.copy(notice = Notice.DraftDone) }
        reloadCard(id)
    }

    fun saveCard(healthNotes: String, personalNotes: String, birthday: String) = withCard("card") { id ->
        api.saveCard(id, healthNotes.trim(), personalNotes.trim(), birthday.trim(), key())
        _state.update { s ->
            s.copy(
                card = s.card?.copy(card = ClientCard.CardNotes(healthNotes.trim().ifEmpty { null }, personalNotes.trim().ifEmpty { null }, birthday.trim().ifEmpty { null })),
                notice = Notice.CardSaved,
            )
        }
    }

    fun saveNote(note: String) = withCard("note") { id ->
        api.saveNote(id, note.trim(), key())
        _state.update { s -> s.copy(card = s.card?.copy(note = note.trim().ifEmpty { null }), notice = Notice.NoteSaved) }
    }

    fun setFlag(flagged: Boolean) = withCard("flag") { id ->
        api.setFlag(id, flagged, key())
        _state.update { s ->
            s.copy(
                card = s.card?.let { c -> c.copy(client = c.client.copy(flagged = flagged)) },
                clients = s.clients.map { if (it.id == id) it.copy(flagged = flagged) else it },
            )
        }
    }

    fun requestPhoto() = withCard("photoreq") { id ->
        api.requestPhoto(id, key())
        _state.update { it.copy(notice = Notice.PhotoRequested) }
    }

    fun nudgeInterview() = withCard("interview") { id ->
        api.nudgeInterview(id, key())
        _state.update { it.copy(notice = Notice.NudgeSent) }
    }

    /** Saves the open client's active plan as a template. A missing active plan is its own message. */
    fun createTemplate(name: String) {
        val id = _state.value.cardId ?: return
        if (name.isBlank()) return
        _state.update { it.copy(busy = "template", actionError = false, templateNoPlan = false, notice = null) }
        viewModelScope.launch {
            try {
                api.createTemplate(id, name.trim(), key())
                _state.update { it.copy(notice = Notice.TemplateCreated) }
            } catch (e: ApiException) {
                if (e.status == 404) _state.update { it.copy(templateNoPlan = true) } else _state.update { it.copy(actionError = true) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }

    fun createInvite(name: String) = act("invite") {
        val prospect = api.createInvite(name.trim(), key())
        _state.update { s ->
            s.copy(
                invite = s.invite?.let { inv -> inv.copy(prospects = listOf(prospect) + inv.prospects) },
                freshInvite = prospect,
            )
        }
    }

    private suspend fun loadCard(clientId: Long, bearer: String?) {
        try {
            val card = api.card(clientId)
            _state.update { if (it.cardId == clientId) it.copy(card = card, cardLoading = false, photoBearer = bearer) else it }
        } catch (e: Exception) {
            _state.update { if (it.cardId == clientId) it.copy(cardLoading = false, cardFailed = true) else it }
        }
    }

    private suspend fun reloadCard(clientId: Long) {
        val card = api.card(clientId)
        _state.update { if (it.cardId == clientId) it.copy(card = card) else it }
    }

    /** Runs one action: busy while it runs, a failure becomes a dismissible note. */
    private fun act(key: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = key, actionError = false, notice = null) }
            try {
                block()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }

    /** An action on the open card; does nothing when no card is open. */
    private fun withCard(key: String, block: suspend (Long) -> Unit) {
        val id = _state.value.cardId ?: return
        act(key) { block(id) }
    }

    private fun key() = Uuid.random().toString()
}
