@file:OptIn(ExperimentalUuidApi::class)

package app.hacklimits.shared.owner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Section ids of the owner console, as the Mini App names them. */
internal const val SECTION_OVERVIEW = "overview"
internal const val SECTION_ROSTER = "roster"
internal const val SECTION_FEEDBACK = "feedback"

/** The roster, the report tabs and the moderation actions. Report and roster failures are shown inline. */
internal class OwnerViewModel(private val api: OwnerApi) : ViewModel() {
    data class State(
        val users: List<OwnerUser>? = null,
        val loadFailed: Boolean = false,
        val section: String = SECTION_OVERVIEW,
        val reports: Map<String, String> = emptyMap(),
        val reportBusy: Boolean = false,
        val actionError: Boolean = false,
        /** "action:id" while a roster action is in flight. */
        val rosterBusy: String? = null,
        val nudged: Set<Long> = emptySet(),
        val inactiveSent: Int? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        loadUsers()
        loadSection(SECTION_OVERVIEW)
    }

    fun retry() {
        loadUsers()
        loadSection(_state.value.section, force = true)
    }

    fun select(section: String) {
        _state.update { it.copy(section = section) }
        loadSection(section)
    }

    fun dismissActionError() = _state.update { it.copy(actionError = false) }

    fun askInactive() {
        viewModelScope.launch {
            try {
                val sent = api.askInactive(Uuid.random().toString())
                _state.update { it.copy(inactiveSent = sent) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            }
        }
    }

    fun moderate(user: OwnerUser, action: String) {
        viewModelScope.launch {
            _state.update { it.copy(rosterBusy = "$action:${user.id}") }
            try {
                api.moderate(user.id, action, Uuid.random().toString())
                if (action == "nudge") _state.update { it.copy(nudged = it.nudged + user.id) } else loadUsersNow()
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(rosterBusy = null) }
            }
        }
    }

    private fun loadUsers() {
        viewModelScope.launch { loadUsersNow() }
    }

    private suspend fun loadUsersNow() {
        _state.update { it.copy(loadFailed = false) }
        try {
            val rows = api.users()
            _state.update { it.copy(users = rows) }
        } catch (e: Exception) {
            _state.update { it.copy(loadFailed = true) }
        }
    }

    private fun loadSection(id: String, force: Boolean = false) {
        if (id == SECTION_ROSTER || id == SECTION_FEEDBACK) return
        if (!force && _state.value.reports.containsKey(id)) return
        viewModelScope.launch {
            _state.update { it.copy(reportBusy = true) }
            try {
                val html = api.report(id)
                _state.update { it.copy(reports = it.reports + (id to html)) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = true) }
            } finally {
                _state.update { it.copy(reportBusy = false) }
            }
        }
    }
}

/** Feedback triage: the inbox filtered by status, with a category and a status per row. */
internal class FeedbackTriageViewModel(private val api: OwnerApi) : ViewModel() {
    data class State(
        /** new, done, wontfix or all. */
        val filter: String = "new",
        /** A feedback category, or "all". */
        val category: String = "all",
        val page: FeedbackPage? = null,
        val busyId: Long? = null,
        /** Tell the author when a row is marked done. */
        val notify: Boolean = true,
        val failed: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        load()
    }

    fun setFilter(filter: String) {
        _state.update { it.copy(filter = filter) }
        load()
    }

    fun setCategory(category: String) = _state.update { it.copy(category = category) }

    fun setNotify(notify: Boolean) = _state.update { it.copy(notify = notify) }

    fun load() {
        viewModelScope.launch { fetch() }
    }

    fun update(row: FeedbackRow, status: String? = null, category: String? = null) {
        viewModelScope.launch {
            _state.update { it.copy(busyId = row.id, failed = false) }
            try {
                api.updateFeedback(row.id, status, category, _state.value.notify, Uuid.random().toString())
                fetch()
            } catch (e: Exception) {
                _state.update { it.copy(failed = true) }
            } finally {
                _state.update { it.copy(busyId = null) }
            }
        }
    }

    private suspend fun fetch() {
        _state.update { it.copy(failed = false) }
        try {
            val page = api.feedback(_state.value.filter)
            _state.update { it.copy(page = page) }
        } catch (e: Exception) {
            _state.update { it.copy(failed = true) }
        }
    }
}

/** Release notes to every chat, the announcement to every user, and the promo picture. */
internal class BroadcastViewModel(private val api: OwnerApi) : ViewModel() {
    data class Release(
        val info: ReleaseInfo? = null,
        val confirm: Boolean = false,
        val busy: Boolean = false,
        val result: ReleaseSent? = null,
        val failed: Boolean = false,
    )

    data class Progress(val sent: Int, val failed: Int, val remaining: Int, val next: Long?, val queued: Int?)

    data class Announce(
        val text: String = "",
        /** One tap reaches everyone (broadcast queue) rather than 25 per tap. */
        val queue: Boolean = false,
        val confirm: Boolean = false,
        val busy: Boolean = false,
        val progress: Progress? = null,
        val failed: Boolean = false,
    )

    enum class ImageStatus { SENT, BUDGET, FAILED }

    data class Image(val prompt: String = "", val busy: Boolean = false, val status: ImageStatus? = null)

    data class State(val release: Release = Release(), val announce: Announce = Announce(), val image: Image = Image())

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        viewModelScope.launch {
            try {
                val info = api.release()
                _state.update { it.copy(release = it.release.copy(info = info), announce = it.announce.copy(queue = info.queue)) }
            } catch (e: Exception) {
                // The panel stays hidden without the release info, as in the Mini App.
            }
        }
    }

    fun askReleaseConfirm(on: Boolean) = _state.update { it.copy(release = it.release.copy(confirm = on)) }

    fun sendRelease() {
        viewModelScope.launch {
            _state.update { it.copy(release = it.release.copy(busy = true, failed = false)) }
            try {
                val r = api.sendRelease(Uuid.random().toString())
                _state.update {
                    it.copy(release = it.release.copy(
                        info = it.release.info?.copy(version = r.version, pending = r.remaining),
                        result = r,
                        confirm = false,
                    ))
                }
            } catch (e: Exception) {
                _state.update { it.copy(release = it.release.copy(failed = true)) }
            } finally {
                _state.update { it.copy(release = it.release.copy(busy = false)) }
            }
        }
    }

    fun setAnnounceText(text: String) = _state.update { it.copy(announce = it.announce.copy(text = text.take(3000))) }

    fun askAnnounceConfirm(on: Boolean) = _state.update { it.copy(announce = it.announce.copy(confirm = on)) }

    fun sendAnnounce() {
        viewModelScope.launch {
            val current = _state.value.announce
            _state.update { it.copy(announce = it.announce.copy(busy = true, failed = false)) }
            try {
                val after = current.progress?.next?.takeIf { it != 0L }
                val r = api.announce(current.text.trim(), after, Uuid.random().toString())
                val prev = _state.value.announce.progress
                val progress = Progress(
                    sent = (prev?.sent ?: 0) + r.sent,
                    failed = (prev?.failed ?: 0) + r.failed,
                    remaining = r.remaining,
                    next = r.next,
                    queued = r.queued,
                )
                _state.update { it.copy(announce = it.announce.copy(progress = progress, confirm = false)) }
            } catch (e: Exception) {
                _state.update { it.copy(announce = it.announce.copy(failed = true)) }
            } finally {
                _state.update { it.copy(announce = it.announce.copy(busy = false)) }
            }
        }
    }

    fun newAnnouncement() = _state.update { it.copy(announce = Announce(queue = it.announce.queue)) }

    fun setPrompt(prompt: String) = _state.update { it.copy(image = it.image.copy(prompt = prompt.take(1000))) }

    fun makeImage() {
        viewModelScope.launch {
            _state.update { it.copy(image = it.image.copy(busy = true, status = null)) }
            val status = try {
                if (api.promoImage(_state.value.image.prompt.trim(), Uuid.random().toString())) ImageStatus.SENT else ImageStatus.FAILED
            } catch (e: ApiException) {
                if (e.status == 429) ImageStatus.BUDGET else ImageStatus.FAILED
            } catch (e: Exception) {
                ImageStatus.FAILED
            }
            _state.update { it.copy(image = it.image.copy(busy = false, status = status)) }
        }
    }
}
