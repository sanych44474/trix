package app.hacklimits.shared.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.chat.ChatApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The notification feed. Opening it marks everything read, once the list has loaded. */
class InboxViewModel(private val api: InboxApi) : ViewModel() {
    data class State(
        /** Null while loading. */
        val items: List<InboxItem>? = null,
        val failed: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(failed = false) }
            try {
                val feed = api.feed()
                _state.update { State(items = feed.items) }
                // A failed mark-read only leaves the badge up until the next open.
                runCatching { api.markRead() }
            } catch (e: Exception) {
                _state.update { it.copy(failed = true) }
            }
        }
    }
}

/**
 * The unread counts the More tab (or any bell) shows. [inboxUnread] is the notification feed;
 * [chatUnread] is per sender for the trainer's client list. Call [refresh] when the screen
 * reappears, since nothing here polls.
 */
class UnreadBadgeViewModel(private val inbox: InboxApi, private val chat: ChatApi) : ViewModel() {
    private val _inboxUnread = MutableStateFlow(0)
    val inboxUnread: StateFlow<Int> = _inboxUnread

    private val _chatUnread = MutableStateFlow<Map<Long, Int>>(emptyMap())
    val chatUnread: StateFlow<Map<Long, Int>> = _chatUnread

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            runCatching { inbox.feed().unread }.onSuccess { _inboxUnread.value = it }
            runCatching { chat.unread() }.onSuccess { _chatUnread.value = it }
        }
    }
}
