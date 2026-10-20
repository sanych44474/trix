package app.hacklimits.shared.data

/** Small non-secret app state that must survive a restart: the workout in progress and saves
 * waiting for the network. Secrets go through [SessionStore] instead. */
interface KeyValueStore {
    suspend fun get(key: String): String?
    suspend fun put(key: String, value: String)
    suspend fun remove(key: String)
}

class InMemoryKeyValueStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()
    override suspend fun get(key: String): String? = map[key]
    override suspend fun put(key: String, value: String) { map[key] = value }
    override suspend fun remove(key: String) { map.remove(key) }
}
