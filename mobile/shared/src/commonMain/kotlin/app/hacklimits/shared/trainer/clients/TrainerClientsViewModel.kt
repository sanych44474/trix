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

/** Confirmations the screen announces; errors are server or client codes mapped in the UI. */
enum class Notice { RequestAccepted, RequestDeclined, Answered, Saved, FlagOn, FlagOff, PhotoRequested, NudgeSent, NudgeNotNeeded, InviteCreated }

/** The trainer's clients: the list with its incoming requests, questions and invite link, and one
 * open client card. Each action sends a fresh Idempotency-Key and reports a server error as a code. */
@OptIn(ExperimentalUuidApi::class)
class TrainerClientsViewModel(private val api: TrainerClientsApi) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val busy: Boolean = false,
        val error: String? = null,
        val notice: Notice? = null,
        val clients: List<ClientRow> = emptyList(),
        val requests: List<TrainerRequest> = emptyList(),
        val questions: List<TrainerQuestion> = emptyList(),
        val invite: TrainerInvite? = null,
        val cardId: Long? = null,
        val card: ClientCard? = null,
        val cardLoading: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(error = null) }
            try {
                coroutineScope {
                    val clients = async { api.clients() }
                    val requests = async { api.requests() }
                    val questions = async { api.questions() }
                    val invite = async { api.invite() }
                    _state.update { it.copy(clients = clients.await(), requests = requests.await(), questions = questions.await(), invite = invite.await()) }
                }
                _state.update { it.copy(loading = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "network") }
            }
        }
    }

    fun resolveRequest(request: TrainerRequest, accept: Boolean) = act {
        api.resolveRequest(request.id, accept, key())
        val clients = if (accept) api.clients() else null
        _state.update {
            it.copy(
                requests = it.requests.filterNot { r -> r.id == request.id },
                clients = clients ?: it.clients,
                notice = if (accept) Notice.RequestAccepted else Notice.RequestDeclined,
            )
        }
    }

    fun answer(question: TrainerQuestion, text: String) = act {
        api.answer(question.id, text, key())
        _state.update { s ->
            s.copy(questions = s.questions.map { if (it.id == question.id) it.copy(status = "answered") else it }, notice = Notice.Answered)
        }
    }

    fun openCard(clientId: Long) {
        _state.update { it.copy(cardId = clientId, card = null, cardLoading = true, error = null, notice = null) }
        viewModelScope.launch {
            try {
                val card = api.card(clientId)
                _state.update { if (it.cardId == clientId) it.copy(card = card, cardLoading = false) else it }
            } catch (e: ApiException) {
                _state.update { if (it.cardId == clientId) it.copy(cardLoading = false, error = e.code) else it }
            } catch (e: Exception) {
                _state.update { if (it.cardId == clientId) it.copy(cardLoading = false, error = "network") else it }
            }
        }
    }

    fun closeCard() = _state.update { it.copy(cardId = null, card = null, cardLoading = false, error = null, notice = null) }

    fun saveCard(healthNotes: String, personalNotes: String, birthday: String) = withCard { id ->
        api.saveCard(id, healthNotes.trim(), personalNotes.trim(), birthday.trim(), key())
        _state.update { s ->
            s.copy(card = s.card?.copy(card = ClientCard.CardNotes(healthNotes.trim().ifEmpty { null }, personalNotes.trim().ifEmpty { null }, birthday.trim().ifEmpty { null })), notice = Notice.Saved)
        }
    }

    fun saveNote(note: String) = withCard { id ->
        api.saveNote(id, note.trim(), key())
        _state.update { s -> s.copy(card = s.card?.copy(note = note.trim().ifEmpty { null }), notice = Notice.Saved) }
    }

    fun setFlag(flagged: Boolean) = withCard { id ->
        api.setFlag(id, flagged, key())
        _state.update { s ->
            s.copy(
                card = s.card?.let { c -> c.copy(client = c.client.copy(flagged = flagged)) },
                clients = s.clients.map { if (it.id == id) it.copy(flagged = flagged) else it },
                notice = if (flagged) Notice.FlagOn else Notice.FlagOff,
            )
        }
    }

    fun requestPhoto() = withCard { id ->
        api.requestPhoto(id, key())
        _state.update { it.copy(notice = Notice.PhotoRequested) }
    }

    fun nudgeInterview() = withCard { id ->
        val alreadyDone = api.nudgeInterview(id, key())
        _state.update { it.copy(notice = if (alreadyDone) Notice.NudgeNotNeeded else Notice.NudgeSent) }
    }

    fun createInvite(name: String) = act {
        val prospect = api.createInvite(name.trim(), key())
        _state.update { s ->
            s.copy(invite = s.invite?.let { inv -> inv.copy(prospects = listOf(prospect) + inv.prospects) }, notice = Notice.InviteCreated)
        }
    }

    /** Runs one action: busy while it runs, a server or network failure becomes a code in `error`. */
    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, notice = null) }
            try {
                block()
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(error = "network") }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    /** An action on the open card; does nothing when no card is open. */
    private fun withCard(block: suspend (Long) -> Unit) {
        val id = _state.value.cardId ?: return
        act { block(id) }
    }

    private fun key() = Uuid.random().toString()
}
