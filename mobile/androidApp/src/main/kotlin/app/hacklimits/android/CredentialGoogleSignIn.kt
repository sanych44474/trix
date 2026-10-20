package app.hacklimits.android

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import app.hacklimits.shared.auth.GoogleResult
import app.hacklimits.shared.auth.GoogleSignIn
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** "Sign in with Google" through Credential Manager. The server supplies its Web client ID (the
 * token's audience) and a one-time nonce it verifies; the app never sees a Google password. */
class CredentialGoogleSignIn(private val activity: () -> Activity?) : GoogleSignIn {
    override suspend fun idToken(serverClientId: String, nonce: String): GoogleResult {
        val host = activity() ?: return GoogleResult.Failed("no_activity")
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce).build())
            .build()
        return try {
            val credential = CredentialManager.create(host).getCredential(host, request).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                GoogleResult.Failed("unexpected_credential")
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleResult.Cancelled
        } catch (e: NoCredentialException) {
            GoogleResult.NoAccount
        } catch (e: GetCredentialException) {
            GoogleResult.Failed(e.type)
        }
    }
}
