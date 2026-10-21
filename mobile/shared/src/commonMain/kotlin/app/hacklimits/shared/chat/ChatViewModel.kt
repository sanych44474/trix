package app.hacklimits.shared.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

private const val POLL_MS = 5_000L
private const val MAX_MESSAGE = 2_000

/**
 * One thread. [peerId] null means the client's own trainer. Refreshes every few seconds while it
 * lives (the Mini App polls only while visible; a native screen keeps its model until it leaves).
 */
@OptIn(ExperimentalUuidApi::class)
class ChatViewModel(private val api: ChatApi, private val peerId: Long?, private val telemetry: Telemetry) : ViewModel() {
    data class State(
        val thread: ChatThread? = null,
        /** The thread could not be loaded and there is nothing to show. */
        val missing: Boolean = false,
        val input: String = "",
        val sending: Boolean = false,
        val drafting: Boolean = false,
        /** "network" for a failed transport, otherwise the server's error code. */
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        viewModelScope.launch {
            load()
            while (true) {
                delay(POLL_MS)
                load()
            }
        }
    }

    fun onInputChange(text: String) = _state.update { it.copy(input = text.take(MAX_MESSAGE), error = null) }

    fun send() {
        val text = _state.value.input.trim()
        if (text.isEmpty() || _state.value.sending) return
        val key = Uuid.random().toString()
        viewModelScope.launch {
            _state.update { it.copy(sending = true, error = null) }
            try {
                api.send(text, peerId, key)
                telemetry.track(if (peerId != null) "app_chat_trainer_sent" else "app_chat_client_sent")
                // Clear the box only if the user has not started a new message meanwhile.
                _state.update { s -> s.copy(input = if (s.input.trim() == text) "" else s.input) }
                load()
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(error = "network") }
            } finally {
                _state.update { it.copy(sending = false) }
            }
        }
    }

    /** Fills the input with the AI's reply draft; nothing is sent until the trainer sends it. */
    fun draft() {
        val with = peerId ?: return
        if (_state.value.drafting || _state.value.sending) return
        viewModelScope.launch {
            _state.update { it.copy(drafting = true, error = null) }
            try {
                val draft = api.draft(with)
                if (draft.isNotBlank()) _state.update { it.copy(input = draft.take(MAX_MESSAGE)) }
                else _state.update { it.copy(error = "empty_draft") }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(error = "network") }
            } finally {
                _state.update { it.copy(drafting = false) }
            }
        }
    }

    private suspend fun load() {
        try {
            val thread = api.thread(peerId)
            _state.update { it.copy(thread = thread, missing = false) }
        } catch (e: Exception) {
            // Keep the last thread on screen; only an empty screen reports the chat as unavailable.
            _state.update { it.copy(missing = it.thread == null) }
        }
    }
}

/**
 * The created-at stamp as the Mini App shows it: "MM-DD HH:MM" from the server's ISO or SQL
 * timestamp. Slicing is bounds-safe for short input.
 */
internal fun chatStamp(createdAt: String): String {
    val from = minOf(5, createdAt.length)
    val to = minOf(16, createdAt.length)
    return createdAt.substring(from, to).replace('T', ' ')
}
