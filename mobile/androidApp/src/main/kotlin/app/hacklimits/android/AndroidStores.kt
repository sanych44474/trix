package app.hacklimits.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.platform.RestAlarm
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Non-secret app state (workout draft, offline saves) in private storage, excluded from backup. */
class PrefsKeyValueStore(context: Context) : KeyValueStore {
    private val prefs = context.getSharedPreferences("app_state", Context.MODE_PRIVATE)
    override suspend fun get(key: String): String? = withContext(Dispatchers.IO) { prefs.getString(key, null) }
    override suspend fun put(key: String, value: String) = withContext(Dispatchers.IO) { prefs.edit { putString(key, value) } }
    override suspend fun remove(key: String) = withContext(Dispatchers.IO) { prefs.edit { remove(key) } }
}

/** The "rest is over" notification when the app is in the background. WorkManager instead of an
 * exact alarm: no special permission, and a few seconds of slack is fine for a rest timer. */
class WorkRestAlarm(private val context: Context) : RestAlarm {
    override fun schedule(seconds: Int, title: String, body: String) {
        val work = OneTimeWorkRequestBuilder<RestOverWorker>()
            .setInitialDelay(seconds.toLong(), TimeUnit.SECONDS)
            .setInputData(workDataOf("title" to title, "body" to body))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, work)
    }

    override fun cancel() {
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
    }

    private companion object { const val WORK = "rest_timer" }
}

class RestOverWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val granted = android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!granted) return Result.success()
        val notification = NotificationCompat.Builder(applicationContext, REMINDERS_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(inputData.getString("title"))
            .setContentText(inputData.getString("body"))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(applicationContext).notify(REST_NOTIFICATION_ID, notification)
        return Result.success()
    }

    private companion object { const val REST_NOTIFICATION_ID = 1001 }
}
