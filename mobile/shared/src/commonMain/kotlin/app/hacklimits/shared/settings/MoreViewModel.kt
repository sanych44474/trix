package app.hacklimits.shared.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.auth.GoogleResult
import app.hacklimits.shared.auth.GoogleSignIn
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.AuthSession
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.data.SettingsApi
import app.hacklimits.shared.data.SettingsState
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.platform.FileSaver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/** "More": reminders, language, vacation, cycle, leaderboard, feedback, data export, trainer
 * disconnect, account linking and account deletion (ProfileView.tsx settings sections). */
class MoreViewModel(
    private val settings: SettingsApi,
    private val auth: AuthApi,
    private val sessions: SessionStore,
    private val google: GoogleSignIn,
    private val files: FileSaver,
    private val platform: AppPlatform,
) : ViewModel() {
    data class State(
        val settings: SettingsState? = null,
        val session: AuthSession? = null,
        val busy: Boolean = false,
        val message: Message? = null,
        val linkEmail: String = "",
        val linkChallengeId: String? = null,
        val linkCode: String = "",
        val vacationDate: String = "",
        val cycleStart: String = "",
        val cycleLen: String = "28",
        val alias: String = "",
        val feedback: String = "",
        val trainerLeft: Boolean = false,
    )

    enum class Message { Saved, Exported, ExportEmpty, EmailLinked, GoogleLinked, FeedbackSent, TrainerLeft, Error, NetworkError }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            val s = runCatching { settings.load() }.getOrNull()
            val session = runCatching { auth.session() }.getOrNull()
            _state.update {
                it.copy(
                    settings = s ?: it.settings,
                    session = session ?: it.session,
                    message = if (s == null) Message.NetworkError else null,
                    cycleStart = s?.cycle?.lastStart ?: it.cycleStart,
                    cycleLen = s?.cycle?.let { c -> c.len.toString() } ?: it.cycleLen,
                    alias = s?.compete?.alias ?: it.alias,
                )
            }
        }
    }

    fun toggleReminder(key: String) = act { settings.toggleReminder(key)?.let { s -> _state.update { it.copy(settings = s) } } }
    fun setLanguage(lang: String) = act { settings.setLanguage(lang)?.let { s -> _state.update { it.copy(settings = s, message = Message.Saved) } } }
    fun vacation(days: Int?) = act { settings.vacation(days)?.let { s -> _state.update { it.copy(settings = s) } } }

    fun onVacationDate(value: String) = _state.update { it.copy(vacationDate = value.trim()) }

    /** Pause until a chosen date; the server takes whole days (1..90). */
    @OptIn(ExperimentalTime::class)
    fun vacationUntilDate() {
        val until = parseIsoDate(_state.value.vacationDate)
        if (until == null) {
            _state.update { it.copy(message = Message.Error) }
            return
        }
        val now = Instant.fromEpochMilliseconds(Clock.System.now().toEpochMilliseconds())
        val today = now.toLocalDateTime(TimeZone.currentSystemDefault()).date
        vacation(vacationDaysUntil(today, until))
    }

    fun toggleCycle(on: Boolean) = act { settings.cycle(on = on)?.let { s -> _state.update { it.copy(settings = s) } } }
    fun onCycleStart(value: String) = _state.update { it.copy(cycleStart = value.trim()) }
    fun onCycleLen(value: String) = _state.update { it.copy(cycleLen = value.filter(Char::isDigit).take(2)) }

    fun saveCycle() = act {
        val s = _state.value
        val start = s.cycleStart.takeIf { it.isNotEmpty() }
        if (start != null && parseIsoDate(start) == null) {
            _state.update { it.copy(message = Message.Error) }
            return@act
        }
        settings.cycle(lastStart = start, len = s.cycleLen.toIntOrNull())?.let { st -> _state.update { it.copy(settings = st) } }
    }

    fun toggleCompete(on: Boolean) = act { settings.compete(on = on)?.let { s -> _state.update { it.copy(settings = s) } } }
    fun onAlias(value: String) = _state.update { it.copy(alias = value.take(30)) }
    fun saveAlias() = act { settings.compete(alias = _state.value.alias.trim())?.let { s -> _state.update { it.copy(settings = s) } } }

    fun onFeedback(value: String) = _state.update { it.copy(feedback = value.take(1500)) }

    fun sendFeedback() {
        val text = _state.value.feedback.trim()
        if (text.length < 2) return
        act {
            settings.feedback(text)?.let { s -> _state.update { it.copy(settings = s, feedback = "", message = Message.FeedbackSent) } }
        }
    }

    /** Saves the export as a file on this device; the server answers with no file when there is nothing to export. */
    fun export(json: Boolean) = act {
        val bytes = settings.export(json)
        if (bytes == null) {
            _state.update { it.copy(message = Message.ExportEmpty) }
            return@act
        }
        val saved = if (json) files.save("hack-limits-export.json", "application/json", bytes)
        else files.save("hack-limits-export.md", "text/markdown", bytes)
        if (saved) _state.update { it.copy(message = Message.Exported) }
    }

    /** Clients only: removes the trainer's access. */
    fun leaveTrainer() = act {
        settings.leaveTrainer()?.let { s -> _state.update { it.copy(settings = s, trainerLeft = true, message = Message.TrainerLeft) } }
    }

    fun onLinkEmail(value: String) = _state.update { it.copy(linkEmail = value.trim()) }
    fun onLinkCode(value: String) = _state.update { it.copy(linkCode = value.filter(Char::isDigit).take(6)) }

    fun sendLinkCode() = act {
        val challenge = auth.startEmail(_state.value.linkEmail, platform.language)
        _state.update { it.copy(linkChallengeId = challenge.challengeId) }
    }

    fun verifyLinkCode() = act {
        val s = _state.value
        auth.verifyEmail(s.linkEmail, s.linkChallengeId ?: return@act, s.linkCode, platform.language)
        _state.update { it.copy(linkChallengeId = null, linkCode = "", message = Message.EmailLinked) }
        load()
    }

    fun linkGoogle() = act {
        val challenge = auth.googleNonce()
        when (val result = google.idToken(challenge.clientId, challenge.nonce)) {
            is GoogleResult.Token -> {
                auth.verifyGoogle(challenge.challengeId, result.idToken, platform.language)
                _state.update { it.copy(message = Message.GoogleLinked) }
                load()
            }
            else -> Unit
        }
    }

    /** Permanent; the screen asks twice before calling this. */
    fun deleteAccount(beforeSignOut: suspend () -> Unit) = act {
        settings.deleteAccount()
        runCatching { beforeSignOut() }
        sessions.clear()
    }

    private fun act(block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, message = null) }
            try {
                block()
            } catch (e: ApiException) {
                _state.update { it.copy(message = Message.Error) }
            } catch (e: Exception) {
                _state.update { it.copy(message = Message.NetworkError) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
