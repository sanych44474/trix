package app.hacklimits.android

import org.json.JSONArray
import com.google.firebase.messaging.RemoteMessage
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.NotificationCompat
import android.os.Build
import android.content.pm.PackageManager
import android.content.Intent
import android.app.PendingIntent
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import app.hacklimits.shared.data.PushApi
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.platform.AppPlatform
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.koin.android.ext.android.inject

const val REMINDERS_CHANNEL = "reminders"

fun createNotificationChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
        NotificationChannel(REMINDERS_CHANNEL, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = context.getString(R.string.channel_reminders_description)
        },
    )
}

/**
 * Push registration by Firebase Installation ID (FCM 25.1+ deprecated tokens in its favour). While
 * signed in, `register()` asks FCM to register this install; the ID arrives in
 * [PushService.onRegistered] and goes to the server. Firebase is optional: without
 * google-services.json there is no FirebaseApp and push stays off.
 */
class PushRegistrar(
    private val context: Context,
    private val push: PushApi,
    private val sessions: SessionStore,
    private val platform: AppPlatform,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun available(): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    fun registerCurrentToken() {
        if (!available()) return
        runCatching { FirebaseMessaging.getInstance().register() }
    }

    fun register(installationId: String) {
        scope.launch {
            if (sessions.token() != null) push.register(installationId, platform.pushPlatform, platform.appVersion, kind = "fid")
        }
    }

    /** Before signing out: this device stops receiving the account's reminders. */
    suspend fun unregister() {
        if (!available()) return
        val id = runCatching { FirebaseInstallations.getInstance().id.await() }.getOrNull() ?: return
        push.unregister(id)
        runCatching { FirebaseMessaging.getInstance().unregister().await() }
    }
}

class PushService : FirebaseMessagingService() {
    private val registrar: PushRegistrar by inject()

    override fun onRegistered(installationId: String) = registrar.register(installationId)

    // The server sends data-only messages (src/adapters/fcm/fcm.ts), so the app draws every
    // notification itself: that is what lets it carry buttons and open the right screen.
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: return
        showNotification(this, title, data["body"].orEmpty(), data["kind"].orEmpty(), data["view"], parseActions(data["actions"]))
    }
}

internal data class PushButton(val label: String, val view: String)

internal fun parseActions(raw: String?): List<PushButton> = runCatching {
    val array = JSONArray(raw ?: return emptyList())
    (0 until minOf(array.length(), 2)).mapNotNull { i ->
        val o = array.optJSONObject(i) ?: return@mapNotNull null
        val label = o.optString("label").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        val view = o.optString("view").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        PushButton(label, view)
    }
}.getOrDefault(emptyList())

internal fun showNotification(context: Context, title: String, body: String, kind: String, view: String?, buttons: List<PushButton>) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
        Build.VERSION.SDK_INT >= 33
    ) return
    // One notification per kind: a newer reminder of the same kind replaces the old one.
    val id = kind.hashCode()
    val builder = NotificationCompat.Builder(context, REMINDERS_CHANNEL)
        .setSmallIcon(R.drawable.ic_launcher_monochrome)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setContentIntent(openIntent(context, view, id * 4))
    buttons.forEachIndexed { i, button -> builder.addAction(0, button.label, openIntent(context, button.view, id * 4 + i + 1)) }
    NotificationManagerCompat.from(context).notify(id, builder.build())
}

private fun openIntent(context: Context, view: String?, requestCode: Int): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .apply { if (view != null) putExtra(EXTRA_VIEW, view) }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}

const val EXTRA_VIEW = "view"
