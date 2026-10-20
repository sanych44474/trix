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

/** "More": account, reminders, language, vacation, data export and account deletion. */
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
    )

    enum class Message { Saved, Exported, EmailLinked, GoogleLinked, Error, NetworkError }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            val s = runCatching { settings.load() }.getOrNull()
            val session = runCatching { auth.session() }.getOrNull()
            _state.update { it.copy(settings = s ?: it.settings, session = session ?: it.session, message = if (s == null) Message.NetworkError else null) }
        }
    }

    fun toggleReminder(key: String) = act { settings.toggleReminder(key)?.let { s -> _state.update { it.copy(settings = s) } } }
    fun setLanguage(lang: String) = act { settings.setLanguage(lang)?.let { s -> _state.update { it.copy(settings = s, message = Message.Saved) } } }
    fun vacation(days: Int?) = act { settings.vacation(days)?.let { s -> _state.update { it.copy(settings = s) } } }

    fun export(json: Boolean) = act {
        val bytes = settings.export(json)
        val saved = if (json) files.save("hack-limits-export.json", "application/json", bytes)
        else files.save("hack-limits-export.md", "text/markdown", bytes)
        if (saved) _state.update { it.copy(message = Message.Exported) }
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
