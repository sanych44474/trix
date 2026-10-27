package app.hacklimits.shared.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Where the bearer session token lives. Platforms keep it encrypted at rest (Android: a Keystore
 * key, see androidMain); it is never logged and never leaves the device except as the
 * Authorization header to our own server.
 */
interface SessionStore {
    val signedIn: StateFlow<Boolean>
    val account: StateFlow<Long?>
    suspend fun token(): String?
    /** Stable server account identifier; null means offline personal data must stay inaccessible. */
    suspend fun accountId(): Long? = account.value
    suspend fun save(token: String, accountId: Long? = null)
    suspend fun clear()
}

/** For tests and previews. */
class InMemorySessionStore(initial: String? = null, private var ownerId: Long? = null) : SessionStore {
    private var value: String? = initial
    private val state = MutableStateFlow(initial != null)
    private val owner = MutableStateFlow(ownerId)
    override val signedIn: StateFlow<Boolean> = state
    override val account: StateFlow<Long?> = owner
    override suspend fun token(): String? = value
    override suspend fun save(token: String, accountId: Long?) { value = token; ownerId = accountId; owner.value = accountId; state.value = true }
    override suspend fun clear() { value = null; ownerId = null; owner.value = null; state.value = false }
}
