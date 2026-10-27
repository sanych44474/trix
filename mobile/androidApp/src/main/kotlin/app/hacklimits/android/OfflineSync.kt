package app.hacklimits.android

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.hacklimits.shared.data.OfflineSyncScheduler
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.workout.PendingSaves
import java.util.concurrent.TimeUnit
import org.koin.core.context.GlobalContext

/** Durable, account-keyed work. A queued operation never carries credentials in WorkManager input. */
class WorkManagerOfflineSyncScheduler(private val context: Context) : OfflineSyncScheduler {
    override fun schedule(accountId: Long) {
        val request = OneTimeWorkRequestBuilder<OfflineSyncWorker>()
            .setInputData(workDataOf(ACCOUNT_ID to accountId))
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "offline_sync_account_$accountId",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private companion object { const val ACCOUNT_ID = "account_id" }
}

class OfflineSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // Account ids can be negative (accounts made without Telegram); 0 means the input is missing.
        val owner = inputData.getLong(ACCOUNT_ID, 0L)
        if (owner == 0L) return Result.failure()
        val koin = GlobalContext.getOrNull() ?: return Result.retry()
        val sessions = koin.get<SessionStore>()
        if (sessions.accountId() != owner) return Result.success()
        val pending = koin.get<PendingSaves>()
        return runCatching { pending.syncPending() }
            .fold(
                onSuccess = { result -> if (result.shouldRetry) Result.retry() else Result.success() },
                onFailure = { Result.retry() },
            )
    }

    private companion object { const val ACCOUNT_ID = "account_id" }
}
