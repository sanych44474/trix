package app.hacklimits.shared.workout

import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.data.OfflineStore
import app.hacklimits.shared.data.OfflineSyncScheduler
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.data.SyncOperation
import app.hacklimits.shared.data.WorkoutApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.io.IOException
import kotlinx.serialization.Serializable
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/** Finished workouts that remain on-device until the owning account acknowledges them. */
@OptIn(ExperimentalTime::class)
class PendingSaves(
    private val legacyStore: KeyValueStore,
    private val offline: OfflineStore,
    private val workoutApi: WorkoutApi,
    private val nutritionApi: NutritionApi,
    private val progressApi: ProgressApi,
    private val sessions: SessionStore,
    private val scheduler: OfflineSyncScheduler,
) {
    @Serializable
    data class Pending(val key: String, val request: SaveWorkoutRequest)

    @Serializable
    private data class PendingDraft(val date: String, val body: String)

    data class FlushResult(val sent: Int, val shouldRetry: Boolean)
    data class QueueCounts(val pending: Int = 0, val needsAttention: Int = 0)

    private val lock = Mutex()

    suspend fun count(): Int = sessions.accountId()?.let { offline.pendingCount(it) } ?: 0

    suspend fun needsAttentionCount(): Int = sessions.accountId()?.let { offline.attentionCount(it) } ?: 0

    suspend fun needsAttentionOperations(): List<SyncOperation> = sessions.accountId()?.let { offline.needsAttention(it) }.orEmpty()

    suspend fun retry(operation: SyncOperation): Boolean = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock false
        if (owner != operation.accountId) return@withLock false
        val updated = offline.retryOperation(owner, operation.id)
        if (updated) scheduler.schedule(owner)
        updated
    }

    suspend fun discard(operation: SyncOperation): Boolean = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock false
        if (owner != operation.accountId) return@withLock false
        offline.removeOperation(owner, operation.id)
        true
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeCounts(): Flow<QueueCounts> = sessions.account.flatMapLatest { owner ->
        if (owner == null) flowOf(QueueCounts())
        else combine(offline.observePendingCount(owner), offline.observeAttentionCount(owner), ::QueueCounts)
    }

    suspend fun add(pending: Pending): Boolean = addOperation(
        kind = WORKOUT_KIND,
        key = pending.key,
        payload = AppJson.encodeToString(Pending.serializer(), pending),
    )

    suspend fun addOperation(kind: String, key: String, payload: String, localRecord: Pair<String, String>? = null): Boolean = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock false
        val createdAt = Clock.System.now().toEpochMilliseconds()
        val operation = SyncOperation(
            accountId = owner,
            id = key,
            kind = kind,
            payload = payload,
            createdAtMs = createdAt,
        )
        if (localRecord == null) offline.enqueue(operation)
        else offline.enqueueAndWrite(operation, localRecord.first, localRecord.second, createdAt)
        // A duplicate means the same stable idempotency key is already safely persisted.
        scheduler.schedule(owner)
        true
    }

    suspend fun queueDraft(date: String, body: String): Boolean = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock false
        val item = PendingDraft(date, body)
        offline.upsert(
            SyncOperation(
                accountId = owner,
                id = "$DRAFT_ID_PREFIX$date",
                kind = DRAFT_KIND,
                payload = AppJson.encodeToString(PendingDraft.serializer(), item),
                createdAtMs = Clock.System.now().toEpochMilliseconds(),
            ),
        )
        scheduler.schedule(owner)
        true
    }

    suspend fun removeDraft(date: String) = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock
        offline.removeOperation(owner, "$DRAFT_ID_PREFIX$date")
    }

    /** Legacy records were device-global. Keep them isolated until a person confirms the account. */
    suspend fun legacyCount(): Int {
        val queue = legacyStore.get(LEGACY_KEY)?.let { raw ->
            runCatching { AppJson.decodeFromString<List<Pending>>(raw).size }.getOrDefault(1)
        } ?: 0
        val otherLegacy = LEGACY_PERSONAL_KEYS.count { legacyStore.get(it) != null }
        return queue + otherLegacy
    }

    /** Moves the old global queue only after an explicit account confirmation in the UI. */
    suspend fun claimLegacyForCurrentAccount(): Boolean = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock false
        val raw = legacyStore.get(LEGACY_KEY)
        val oldItems = raw?.let { runCatching { AppJson.decodeFromString<List<Pending>>(it) }.getOrNull() ?: return@withLock false } ?: emptyList()
        oldItems.forEach { old ->
            offline.enqueue(
                SyncOperation(
                    accountId = owner,
                    id = old.key,
                    kind = WORKOUT_KIND,
                    payload = AppJson.encodeToString(Pending.serializer(), old),
                    createdAtMs = Clock.System.now().toEpochMilliseconds(),
                ),
            )
        }
        // Each insert is idempotent by account + original key, so a process death during the move is safe.
        if (raw != null) legacyStore.remove(LEGACY_KEY)
        LEGACY_PERSONAL_KEYS.forEach { key ->
            val payload = legacyStore.get(key) ?: return@forEach
            offline.write(owner, key, payload, Clock.System.now().toEpochMilliseconds())
            legacyStore.remove(key)
        }
        if (oldItems.isNotEmpty()) scheduler.schedule(owner)
        true
    }

    suspend fun syncPending(): FlushResult = lock.withLock {
        val owner = sessions.accountId() ?: return@withLock FlushResult(sent = 0, shouldRetry = false)
        val queue = offline.pending(owner)
        var sent = 0
        for (operation in queue) {
            // Re-check the owner before every request: a sign-out/account switch holds the remaining rows.
            if (sessions.accountId() != owner) break
            val workout = if (operation.kind == WORKOUT_KIND) {
                runCatching { AppJson.decodeFromString<Pending>(operation.payload) }.getOrNull()
            } else null
            val draft = if (operation.kind == DRAFT_KIND) {
                runCatching { AppJson.decodeFromString<PendingDraft>(operation.payload) }.getOrNull()
            } else null
            if (operation.kind == WORKOUT_KIND && workout == null) {
                offline.markFailed(operation, retryable = false, error = "invalid_saved_workout")
                continue
            }
            if (operation.kind == DRAFT_KIND && draft == null) {
                offline.markFailed(operation, retryable = false, error = "invalid_workout_draft")
                continue
            }
            if (operation.kind !in setOf(WORKOUT_KIND, DRAFT_KIND, NUTRITION_KIND, PROGRESS_KIND)) {
                offline.markFailed(operation, retryable = false, error = "unsupported_sync_operation")
                continue
            }
            try {
                when (operation.kind) {
                    WORKOUT_KIND -> workoutApi.save(requireNotNull(workout).request, operation.id)
                    DRAFT_KIND -> workoutApi.putDraft(requireNotNull(draft).date, requireNotNull(draft).body)
                    NUTRITION_KIND -> nutritionApi.performQueued(operation.payload, operation.id)
                    PROGRESS_KIND -> progressApi.performQueued(operation.payload, operation.id)
                    else -> Unit
                }
                offline.markSynced(operation)
                sent++
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                val authExpired = e.status == 401
                val retry = authExpired || (e.retryable ?: (e.status == 0 || e.status == 408 || e.status == 429 || e.status >= 500))
                if (authExpired) {
                    offline.markFailed(operation, retry, e.code)
                    return@withLock FlushResult(sent, shouldRetry = false)
                }
                // Past the cap the row needs a person, and the queue moves on instead of stalling behind it.
                val giveUp = retry && operation.retryCount + 1 >= MAX_SYNC_ATTEMPTS
                offline.markFailed(operation, retry && !giveUp, e.code)
                if (retry && !giveUp) return@withLock FlushResult(sent, shouldRetry = true)
            } catch (_: IOException) {
                // No network: never counted toward the cap. A save made offline must wait for the
                // network however long that takes, not be parked after ten tries in a basement.
                offline.markFailed(operation, retryable = true, error = "network")
                return@withLock FlushResult(sent, shouldRetry = true)
            } catch (e: Exception) {
                // Anything else (a payload that cannot be built or read) fails the same way every time.
                val giveUp = operation.retryCount + 1 >= MAX_SYNC_ATTEMPTS
                offline.markFailed(operation, retryable = !giveUp, error = e::class.simpleName ?: "error")
                if (!giveUp) return@withLock FlushResult(sent, shouldRetry = true)
            }
        }
        FlushResult(sent, shouldRetry = false)
    }

    /** Kept for foreground callers; background work uses [syncPending] to apply WorkManager retry policy. */
    suspend fun flush(): Int = syncPending().sent

    suspend fun scheduleIfPending() {
        val owner = sessions.accountId() ?: return
        if (offline.pendingCount(owner) > 0) scheduler.schedule(owner)
    }

    companion object {
        /** Failed attempts before a retryable row is parked as needs_attention. */
        const val MAX_SYNC_ATTEMPTS = 10
        const val WORKOUT_KIND = "workout.save"
        const val DRAFT_KIND = "workout.draft"
        const val NUTRITION_KIND = "nutrition.action"
        const val PROGRESS_KIND = "progress.log"
        private const val DRAFT_ID_PREFIX = "draft:"
        const val LEGACY_KEY = "pending_workout_saves"
        const val LEGACY_DRAFT_KEY = "workout_draft_v2"
        const val LEGACY_TODAY_KEY = "workout_today_cache"
        val LEGACY_PERSONAL_KEYS = listOf(
            LEGACY_DRAFT_KEY,
            LEGACY_TODAY_KEY,
            "workout_rest_prefs",
            "workout_rest_by_exercise",
            "workout_rest_chosen",
            "workout_rest_running",
        )
    }
}
