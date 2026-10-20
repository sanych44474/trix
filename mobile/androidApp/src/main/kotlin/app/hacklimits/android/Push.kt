package app.hacklimits.android

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
    // Notification messages are shown by the system while the app is in the background; in the
    // foreground FCM hands them here, and the next screen refresh shows the same information.
}
