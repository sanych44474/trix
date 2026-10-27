package app.hacklimits.shared.data

import androidx.room3.Dao
import androidx.room3.Entity
import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.PrimaryKey
import androidx.room3.Query
import androidx.room3.Transaction
import kotlinx.coroutines.flow.Flow
import kotlin.time.ExperimentalTime

@Entity(tableName = "cached_records", primaryKeys = ["accountId", "recordKey"])
data class CachedRecordEntity(
    val accountId: Long,
    val recordKey: String,
    val payload: String,
    val updatedAtMs: Long,
)

@Entity(tableName = "sync_outbox")
data class OutboxEntity(
    @PrimaryKey val storageKey: String,
    val accountId: Long,
    val operationId: String,
    val kind: String,
    val payload: String,
    val createdAtMs: Long,
    /** pending, retry, or needs_attention */
    val state: String = "pending",
    val retryCount: Int = 0,
    val lastError: String? = null,
)

@Dao
interface OfflineDao {
    @Query("SELECT payload FROM cached_records WHERE accountId = :accountId AND recordKey = :key LIMIT 1")
    suspend fun readRecord(accountId: Long, key: String): String?

    @Query("SELECT updatedAtMs FROM cached_records WHERE accountId = :accountId AND recordKey = :key LIMIT 1")
    suspend fun readRecordUpdatedAt(accountId: Long, key: String): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun writeRecord(record: CachedRecordEntity)

    @Query("DELETE FROM cached_records WHERE accountId = :accountId AND recordKey = :key")
    suspend fun deleteRecord(accountId: Long, key: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOutbox(item: OutboxEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertOutbox(item: OutboxEntity)

    @Transaction
    suspend fun enqueueAndWrite(item: OutboxEntity, record: CachedRecordEntity): Boolean {
        if (insertOutbox(item) == -1L) return false
        writeRecord(record)
        return true
    }

    @Query("SELECT * FROM sync_outbox WHERE accountId = :accountId AND state IN ('pending', 'retry') ORDER BY createdAtMs, operationId")
    suspend fun pending(accountId: Long): List<OutboxEntity>

    @Query("SELECT * FROM sync_outbox WHERE accountId = :accountId AND state = 'needs_attention' ORDER BY createdAtMs, operationId")
    suspend fun needsAttention(accountId: Long): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE accountId = :accountId AND state IN ('pending', 'retry')")
    suspend fun pendingCount(accountId: Long): Int

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE accountId = :accountId AND state = 'needs_attention'")
    suspend fun attentionCount(accountId: Long): Int

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE accountId = :accountId AND state IN ('pending', 'retry')")
    fun observePendingCount(accountId: Long): Flow<Int>

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE accountId = :accountId AND state = 'needs_attention'")
    fun observeAttentionCount(accountId: Long): Flow<Int>

    @Query("UPDATE sync_outbox SET state = :state, retryCount = retryCount + 1, lastError = :error WHERE storageKey = :storageKey")
    suspend fun markFailed(storageKey: String, state: String, error: String)

    @Query("UPDATE sync_outbox SET state = 'pending', retryCount = 0, lastError = NULL WHERE storageKey = :storageKey AND state = 'needs_attention'")
    suspend fun retryOutbox(storageKey: String): Int

    @Query("DELETE FROM sync_outbox WHERE storageKey = :storageKey")
    suspend fun deleteOutbox(storageKey: String)
}

data class SyncOperation(
    val accountId: Long,
    val id: String,
    val kind: String,
    val payload: String,
    val createdAtMs: Long,
    val state: String = "pending",
    val retryCount: Int = 0,
    val lastError: String? = null,
) {
    val storageKey: String get() = "$accountId:$id"
}

fun ApiException.canFallbackToCache(): Boolean =
    status == 0 || status == 408 || status == 429 || status >= 500

/** Platform-independent persistence seam. Android uses Room; shared code owns cache and sync policy. */
interface OfflineStore {
    suspend fun read(accountId: Long, key: String): String?
    suspend fun lastUpdatedAt(accountId: Long, key: String): Long?
    suspend fun write(accountId: Long, key: String, payload: String, updatedAtMs: Long)
    suspend fun remove(accountId: Long, key: String)
    suspend fun enqueue(operation: SyncOperation): Boolean
    suspend fun enqueueAndWrite(operation: SyncOperation, key: String, payload: String, updatedAtMs: Long): Boolean
    suspend fun upsert(operation: SyncOperation)
    suspend fun removeOperation(accountId: Long, operationId: String)
    suspend fun retryOperation(accountId: Long, operationId: String): Boolean
    suspend fun pending(accountId: Long): List<SyncOperation>
    suspend fun needsAttention(accountId: Long): List<SyncOperation>
    suspend fun pendingCount(accountId: Long): Int
    suspend fun attentionCount(accountId: Long): Int
    fun observePendingCount(accountId: Long): Flow<Int>
    fun observeAttentionCount(accountId: Long): Flow<Int>
    suspend fun markSynced(operation: SyncOperation)
    suspend fun markFailed(operation: SyncOperation, retryable: Boolean, error: String)
}

fun interface OfflineSyncScheduler {
    fun schedule(accountId: Long)
}

object NoOfflineSyncScheduler : OfflineSyncScheduler {
    override fun schedule(accountId: Long) = Unit
}

class RoomOfflineStore(private val dao: OfflineDao) : OfflineStore {
    override suspend fun read(accountId: Long, key: String): String? = dao.readRecord(accountId, key)

    override suspend fun lastUpdatedAt(accountId: Long, key: String): Long? = dao.readRecordUpdatedAt(accountId, key)

    override suspend fun write(accountId: Long, key: String, payload: String, updatedAtMs: Long) {
        dao.writeRecord(CachedRecordEntity(accountId, key, payload, updatedAtMs))
    }

    override suspend fun remove(accountId: Long, key: String) = dao.deleteRecord(accountId, key)

    override suspend fun enqueue(operation: SyncOperation): Boolean = dao.insertOutbox(operation.toEntity()) != -1L

    override suspend fun enqueueAndWrite(operation: SyncOperation, key: String, payload: String, updatedAtMs: Long): Boolean =
        dao.enqueueAndWrite(operation.toEntity(), CachedRecordEntity(operation.accountId, key, payload, updatedAtMs))

    override suspend fun upsert(operation: SyncOperation) = dao.upsertOutbox(operation.toEntity())

    override suspend fun removeOperation(accountId: Long, operationId: String) = dao.deleteOutbox("$accountId:$operationId")

    override suspend fun retryOperation(accountId: Long, operationId: String): Boolean = dao.retryOutbox("$accountId:$operationId") > 0

    override suspend fun pending(accountId: Long): List<SyncOperation> = dao.pending(accountId).map { it.toOperation() }

    override suspend fun needsAttention(accountId: Long): List<SyncOperation> = dao.needsAttention(accountId).map { it.toOperation() }

    override suspend fun pendingCount(accountId: Long): Int = dao.pendingCount(accountId)

    override suspend fun attentionCount(accountId: Long): Int = dao.attentionCount(accountId)

    override fun observePendingCount(accountId: Long): Flow<Int> = dao.observePendingCount(accountId)

    override fun observeAttentionCount(accountId: Long): Flow<Int> = dao.observeAttentionCount(accountId)

    override suspend fun markSynced(operation: SyncOperation) {
        dao.deleteOutbox(operation.storageKey)
    }

    override suspend fun markFailed(operation: SyncOperation, retryable: Boolean, error: String) {
        dao.markFailed(operation.storageKey, if (retryable) "retry" else "needs_attention", error)
    }

    private fun SyncOperation.toEntity() = OutboxEntity(
        storageKey = storageKey,
        accountId = accountId,
        operationId = id,
        kind = kind,
        payload = payload,
        createdAtMs = createdAtMs,
        state = state,
        retryCount = retryCount,
        lastError = lastError,
    )

    private fun OutboxEntity.toOperation() = SyncOperation(
        accountId = accountId,
        id = operationId,
        kind = kind,
        payload = payload,
        createdAtMs = createdAtMs,
        state = state,
        retryCount = retryCount,
        lastError = lastError,
    )
}

/** A cache always requires a known authenticated account; there is deliberately no device-global fallback. */
@OptIn(ExperimentalTime::class)
class AccountCache(private val offline: OfflineStore, private val sessions: SessionStore) {
    suspend fun accountId(): Long? = sessions.accountId()

    suspend fun read(key: String): String? = sessions.accountId()?.let { offline.read(it, key) }

    suspend fun lastUpdatedAt(key: String): Long? = sessions.accountId()?.let { offline.lastUpdatedAt(it, key) }

    suspend fun write(key: String, payload: String) {
        val id = sessions.accountId() ?: return
        offline.write(id, key, payload, kotlin.time.Clock.System.now().toEpochMilliseconds())
    }

    suspend fun remove(key: String) {
        val id = sessions.accountId() ?: return
        offline.remove(id, key)
    }
}

class InMemoryOfflineStore : OfflineStore {
    private val records = mutableMapOf<Pair<Long, String>, String>()
    private val recordUpdatedAt = mutableMapOf<Pair<Long, String>, Long>()
    private val operations = linkedMapOf<String, SyncOperation>()
    private val pendingCounts = mutableMapOf<Long, kotlinx.coroutines.flow.MutableStateFlow<Int>>()
    private val attentionCounts = mutableMapOf<Long, kotlinx.coroutines.flow.MutableStateFlow<Int>>()

    override suspend fun read(accountId: Long, key: String): String? = records[accountId to key]
    override suspend fun lastUpdatedAt(accountId: Long, key: String): Long? = recordUpdatedAt[accountId to key]
    override suspend fun write(accountId: Long, key: String, payload: String, updatedAtMs: Long) {
        records[accountId to key] = payload
        recordUpdatedAt[accountId to key] = updatedAtMs
    }
    override suspend fun remove(accountId: Long, key: String) {
        records.remove(accountId to key)
        recordUpdatedAt.remove(accountId to key)
    }

    override suspend fun enqueue(operation: SyncOperation): Boolean {
        val added = operations.putIfAbsent(operation.storageKey, operation) == null
        if (added) updateCount(operation.accountId)
        return added
    }

    override suspend fun enqueueAndWrite(operation: SyncOperation, key: String, payload: String, updatedAtMs: Long): Boolean {
        val added = operations.putIfAbsent(operation.storageKey, operation) == null
        if (added) {
            records[operation.accountId to key] = payload
            recordUpdatedAt[operation.accountId to key] = updatedAtMs
            updateCount(operation.accountId)
        }
        return added
    }

    override suspend fun upsert(operation: SyncOperation) {
        operations[operation.storageKey] = operation
        updateCount(operation.accountId)
    }

    override suspend fun removeOperation(accountId: Long, operationId: String) {
        operations.remove("$accountId:$operationId")
        updateCount(accountId)
    }

    override suspend fun retryOperation(accountId: Long, operationId: String): Boolean {
        val storageKey = "$accountId:$operationId"
        val item = operations[storageKey]?.takeIf { it.state == "needs_attention" } ?: return false
        operations[storageKey] = item.copy(state = "pending", retryCount = 0, lastError = null)
        updateCount(accountId)
        return true
    }

    override suspend fun pending(accountId: Long): List<SyncOperation> = operations.values.filter { it.accountId == accountId && it.state in setOf("pending", "retry") }
    override suspend fun needsAttention(accountId: Long): List<SyncOperation> = operations.values.filter { it.accountId == accountId && it.state == "needs_attention" }
    override suspend fun pendingCount(accountId: Long): Int = pending(accountId).size
    override suspend fun attentionCount(accountId: Long): Int = needsAttention(accountId).size
    override fun observePendingCount(accountId: Long): Flow<Int> = pendingCounts.getOrPut(accountId) { kotlinx.coroutines.flow.MutableStateFlow(0) }
    override fun observeAttentionCount(accountId: Long): Flow<Int> = attentionCounts.getOrPut(accountId) { kotlinx.coroutines.flow.MutableStateFlow(0) }

    override suspend fun markSynced(operation: SyncOperation) {
        operations.remove(operation.storageKey)
        updateCount(operation.accountId)
    }

    override suspend fun markFailed(operation: SyncOperation, retryable: Boolean, error: String) {
        operations[operation.storageKey] = operation.copy(
            state = if (retryable) "retry" else "needs_attention",
            retryCount = operation.retryCount + 1,
            lastError = error,
        )
        updateCount(operation.accountId)
    }

    private suspend fun updateCount(accountId: Long) {
        pendingCounts.getOrPut(accountId) { kotlinx.coroutines.flow.MutableStateFlow(0) }.value = pendingCount(accountId)
        attentionCounts.getOrPut(accountId) { kotlinx.coroutines.flow.MutableStateFlow(0) }.value = attentionCount(accountId)
    }
}
