package app.hacklimits.shared.data

import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

@Serializable data class AuthProviders(val googleClientId: String? = null, val telegramAvailable: Boolean = false)
@Serializable data class EmailChallenge(val challengeId: String, val expiresInSeconds: Int = 600)
@Serializable data class GoogleChallenge(val challengeId: String, val nonce: String, val clientId: String)
@Serializable data class TelegramChallenge(
    val challengeId: String,
    val completionToken: String,
    val matchCode: String = "",
    val telegramUrl: String,
    val expiresInSeconds: Int = 600,
)
@Serializable data class TelegramStatus(val verified: Boolean, val expired: Boolean)
@Serializable data class AuthSession(
    val authenticated: Boolean,
    val accountId: Long? = null,
    val method: String? = null,
    val email: String? = null,
    val sessionToken: String? = null,
)

/** The sign-in endpoints (src/webapp/emailAuth.ts, providerAuth.ts). A successful sign-in returns
 * the session token in the body because every request says X-Client: native; it is stored at once. */
class AuthApi(private val api: ApiClient, private val sessions: SessionStore) {
    suspend fun providers(): AuthProviders = api.unwrap(api.http.get("api/v2/auth/providers"))

    suspend fun session(): AuthSession = api.unwrap(api.http.get("api/v2/auth/session") { api.authorize(this) })

    suspend fun startEmail(email: String, lang: String): EmailChallenge =
        api.unwrap(api.http.post("api/v2/auth/email/start") { json(mapOf("email" to email, "lang" to lang)) })

    suspend fun verifyEmail(email: String, challengeId: String, code: String, lang: String): AuthSession =
        signedIn(api.unwrap(api.http.post("api/v2/auth/email/verify") {
            json(mapOf("email" to email, "challengeId" to challengeId, "code" to code, "lang" to lang))
        }))

    suspend fun googleNonce(): GoogleChallenge = api.unwrap(api.http.post("api/v2/auth/google/nonce") { json(emptyMap()) })

    suspend fun verifyGoogle(challengeId: String, idToken: String, lang: String): AuthSession =
        signedIn(api.unwrap(api.http.post("api/v2/auth/google/verify") {
            json(mapOf("challengeId" to challengeId, "idToken" to idToken, "lang" to lang))
        }))

    suspend fun startTelegram(): TelegramChallenge = api.unwrap(api.http.post("api/v2/auth/telegram/start") { json(emptyMap()) })

    suspend fun telegramStatus(challengeId: String): TelegramStatus =
        api.unwrap(api.http.get("api/v2/auth/telegram/status") { parameter("challengeId", challengeId) })

    suspend fun completeTelegram(challenge: TelegramChallenge): AuthSession =
        signedIn(api.unwrap(api.http.post("api/v2/auth/telegram/complete") {
            json(mapOf("challengeId" to challenge.challengeId, "completionToken" to challenge.completionToken))
        }))

    suspend fun logout() {
        runCatching { api.http.post("api/v2/auth/logout") { api.authorize(this); json(emptyMap()) } }
        sessions.clear()
    }

    private suspend fun signedIn(session: AuthSession): AuthSession {
        val token = session.sessionToken ?: throw ApiException(500, "no_session_token", "The server did not return a session")
        sessions.save(token)
        return session.copy(sessionToken = null)
    }
}

internal fun io.ktor.client.request.HttpRequestBuilder.json(body: Map<String, String>) {
    contentType(ContentType.Application.Json)
    setBody(body)
}
