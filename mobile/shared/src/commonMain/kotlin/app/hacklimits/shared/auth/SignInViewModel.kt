package app.hacklimits.shared.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.AuthProviders
import app.hacklimits.shared.data.TelegramChallenge
import app.hacklimits.shared.platform.AppPlatform
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Sign-in flow: Google (native), Telegram (confirm in the bot, matching a code) or a one-time
 * email code. Error codes come from the server and are turned into text by the screen. */
class SignInViewModel(private val auth: AuthApi, private val google: GoogleSignIn, private val platform: AppPlatform) : ViewModel() {

    data class State(
        val providers: AuthProviders? = null,
        /** The provider list could not be loaded (offline): the screen offers a retry. */
        val providersFailed: Boolean = false,
        val busy: Boolean = false,
        val email: String = "",
        val emailChallengeId: String? = null,
        val code: String = "",
        val telegram: TelegramChallenge? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var telegramPoll: Job? = null

    init { loadProviders() }

    fun loadProviders() {
        viewModelScope.launch {
            val providers = runCatching { auth.providers() }.getOrNull()
            _state.update { it.copy(providers = providers ?: AuthProviders(), providersFailed = providers == null) }
        }
    }

    fun onEmail(value: String) = _state.update { it.copy(email = value.trim(), error = null) }
    fun onCode(value: String) = _state.update { it.copy(code = value.filter(Char::isDigit).take(6), error = null) }
    fun changeEmail() = _state.update { it.copy(emailChallengeId = null, code = "", error = null) }

    fun sendCode() = run {
        val challenge = auth.startEmail(_state.value.email, platform.language)
        _state.update { it.copy(emailChallengeId = challenge.challengeId) }
    }

    fun verifyCode() = run {
        val s = _state.value
        auth.verifyEmail(s.email, s.emailChallengeId ?: return@run, s.code, platform.language)
    }

    fun signInWithGoogle() = run {
        val challenge = auth.googleNonce()
        when (val result = google.idToken(challenge.clientId, challenge.nonce)) {
            is GoogleResult.Token -> auth.verifyGoogle(challenge.challengeId, result.idToken, platform.language)
            GoogleResult.Cancelled -> Unit
            GoogleResult.NoAccount -> throw ApiException(0, "google_no_account", null)
            is GoogleResult.Failed -> throw ApiException(0, "google_failed", result.reason)
        }
    }

    /** Creates the sign-in request; the screen opens [TelegramChallenge.telegramUrl] and shows the
     * match code. We then poll until the person taps Confirm in the bot. */
    fun startTelegram() = run {
        val challenge = auth.startTelegram()
        _state.update { it.copy(telegram = challenge) }
        telegramPoll?.cancel()
        telegramPoll = viewModelScope.launch { pollTelegram(challenge) }
    }

    fun cancelTelegram() {
        telegramPoll?.cancel()
        _state.update { it.copy(telegram = null) }
    }

    private suspend fun pollTelegram(challenge: TelegramChallenge) {
        while (viewModelScope.isActive) {
            delay(2_000)
            val status = runCatching { auth.telegramStatus(challenge.challengeId) }.getOrNull() ?: continue
            if (status.expired) {
                _state.update { it.copy(telegram = null, error = "telegram_expired") }
                return
            }
            if (status.verified) {
                run { auth.completeTelegram(challenge) }
                return
            }
        }
    }

    /** Runs a network step with the busy flag and turns a failure into an error code. */
    private fun run(block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
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
}
