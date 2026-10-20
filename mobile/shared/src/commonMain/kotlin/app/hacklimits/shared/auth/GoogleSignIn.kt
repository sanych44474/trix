package app.hacklimits.shared.auth

/** Platform Google sign-in: on Android, Credential Manager with the server's Web client ID as
 * audience and the server's one-time nonce. */
fun interface GoogleSignIn {
    suspend fun idToken(serverClientId: String, nonce: String): GoogleResult
}

sealed interface GoogleResult {
    data class Token(val idToken: String) : GoogleResult
    data object Cancelled : GoogleResult
    data object NoAccount : GoogleResult
    data class Failed(val reason: String) : GoogleResult
}
