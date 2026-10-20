package app.hacklimits.shared.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Squads, challenges and the leaderboard. Each section loads on its own, so one failing call
 * leaves the other two usable. Confirmations are a [Notice] the screen turns into text. */
@OptIn(ExperimentalUuidApi::class)
class SocialViewModel(private val api: SocialApi) : ViewModel() {
    enum class Notice {
        SQUAD_CREATED, SQUAD_JOINED, SQUAD_ALREADY, SQUAD_LEFT,
        JOIN_NOT_FOUND, JOIN_FULL, TOO_MANY_SQUADS,
        CHALLENGE_JOINED, COMPETE_ON, COMPETE_OFF,
    }

    data class State(
        val squads: List<Squad>? = null,
        val challenges: Challenges? = null,
        val boards: Boards? = null,
        val loading: Boolean = true,
        val loadError: String? = null,
        val busy: Boolean = false,
        val error: String? = null,
        val notice: Notice? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = null) }
            val squads = async { attempt { api.squads() } }
            val challenges = async { attempt { api.challenges() } }
            val boards = async { attempt { api.boards() } }
            val (s, e1) = squads.await()
            val (c, e2) = challenges.await()
            val (b, e3) = boards.await()
            _state.update {
                it.copy(
                    loading = false,
                    squads = s ?: it.squads,
                    challenges = c ?: it.challenges,
                    boards = b ?: it.boards,
                    loadError = e1 ?: e2 ?: e3,
                )
            }
        }
    }

    fun createSquad(title: String) = act {
        val r = api.createSquad(title.trim(), Uuid.random().toString())
        if (r.ok) {
            reloadSquads()
            Notice.SQUAD_CREATED
        } else squadNotice(r.reason)
    }

    /** Accepts the pasted link (t.me/<bot>?start=sq_CODE) or the bare code. */
    fun joinSquad(input: String) {
        val code = inviteCodeFrom(input)
        if (code.isEmpty()) return
        act {
            val r = api.joinSquad(code, Uuid.random().toString())
            if (r.ok) reloadSquads()
            squadNotice(r.reason)
        }
    }

    fun leaveSquad(id: Long) = act {
        api.leaveSquad(id)
        reloadSquads()
        Notice.SQUAD_LEFT
    }

    fun joinChallenge(code: String) = act {
        api.joinChallenge(code, Uuid.random().toString())
        val fresh = api.challenges()
        _state.update { it.copy(challenges = fresh) }
        Notice.CHALLENGE_JOINED
    }

    fun setCompete(on: Boolean) = act {
        api.setCompete(on)
        val fresh = api.boards()
        _state.update { it.copy(boards = fresh) }
        if (on) Notice.COMPETE_ON else Notice.COMPETE_OFF
    }

    private suspend fun reloadSquads() {
        val fresh = api.squads()
        _state.update { it.copy(squads = fresh) }
    }

    /** One action at a time. The block returns the confirmation to show, or null for none. */
    private fun act(block: suspend () -> Notice?) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, notice = null) }
            try {
                val notice = block()
                _state.update { it.copy(busy = false, notice = notice) }
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "network") }
            }
        }
    }

    private fun squadNotice(reason: String?): Notice? = when (reason) {
        "joined" -> Notice.SQUAD_JOINED
        "already" -> Notice.SQUAD_ALREADY
        "not_found" -> Notice.JOIN_NOT_FOUND
        "full" -> Notice.JOIN_FULL
        "too_many" -> Notice.TOO_MANY_SQUADS
        else -> null
    }

    private suspend fun <T> attempt(block: suspend () -> T): Pair<T?, String?> = try {
        block() to null
    } catch (e: ApiException) {
        null to e.code
    } catch (e: Exception) {
        null to "network"
    }
}

/** The code inside a Mini App / bot invite link (...?start=sq_CODE), or the input itself when it
 * is already a bare code. Mirrors inviteCodeFrom in apps/mini-app/src/Squads.tsx. */
internal fun inviteCodeFrom(input: String): String {
    val link = Regex("sq_([a-z0-9]+)", RegexOption.IGNORE_CASE).find(input)
    return (link?.groupValues?.get(1) ?: input).trim().lowercase()
}
