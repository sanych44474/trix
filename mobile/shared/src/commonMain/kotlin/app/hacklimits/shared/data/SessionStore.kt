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
    suspend fun token(): String?
    suspend fun save(token: String)
    suspend fun clear()
}

/** For tests and previews. */
class InMemorySessionStore(initial: String? = null) : SessionStore {
    private var value: String? = initial
    private val state = MutableStateFlow(initial != null)
    override val signedIn: StateFlow<Boolean> = state
    override suspend fun token(): String? = value
    override suspend fun save(token: String) { value = token; state.value = true }
    override suspend fun clear() { value = null; state.value = false }
}
