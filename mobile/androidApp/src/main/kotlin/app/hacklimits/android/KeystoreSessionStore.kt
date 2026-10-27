package app.hacklimits.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import app.hacklimits.shared.data.SessionStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

/**
 * The session token, AES-GCM encrypted with a non-exportable Android Keystore key. Only the
 * ciphertext and IV sit in private app storage, which is also excluded from backup and device
 * transfer (res/xml/backup_rules.xml), so a copied app-data folder can't be replayed elsewhere.
 */
class KeystoreSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(prefs.contains(KEY_TOKEN))
    // Accounts made without Telegram have negative ids, so presence (not sign) says there is one.
    private val owner = MutableStateFlow(if (prefs.contains(KEY_ACCOUNT_ID)) prefs.getLong(KEY_ACCOUNT_ID, 0L).takeIf { it != 0L } else null)
    override val signedIn: StateFlow<Boolean> = state
    override val account: StateFlow<Long?> = owner

    override suspend fun token(): String? = withContext(Dispatchers.IO) {
        val stored = prefs.getString(KEY_TOKEN, null) ?: return@withContext null
        runCatching { decrypt(stored) }.getOrElse {
            // Key gone (app data restored on another device, keystore reset): sign in again.
            prefs.edit { remove(KEY_TOKEN); remove(KEY_ACCOUNT_ID) }
            owner.value = null
            state.value = false
            null
        }
    }

    override suspend fun save(token: String, accountId: Long?) = withContext(Dispatchers.IO) {
        // commit, not apply: the token must be on disk before the app moves on as signed in.
        prefs.edit(commit = true) {
            putString(KEY_TOKEN, encrypt(token))
            if (accountId != null && accountId != 0L) putLong(KEY_ACCOUNT_ID, accountId) else remove(KEY_ACCOUNT_ID)
        }
        owner.value = accountId?.takeIf { it != 0L }
        state.value = true
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        prefs.edit(commit = true) { remove(KEY_TOKEN); remove(KEY_ACCOUNT_ID) }
        owner.value = null
        state.value = false
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
        }
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "hacklimits_session"
        const val KEY_TOKEN = "token"
        const val KEY_ACCOUNT_ID = "account_id"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
