package app.hacklimits.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import app.hacklimits.shared.update.AppUpdater
import app.hacklimits.shared.update.VersionGate
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * Play In-App Updates. Immediate: Play's full-screen flow (used below the server's minimum).
 * Flexible: downloads in the background, then [readyToInstall] asks for a restart.
 * Outside Play (sideloaded APK, emulator) there is no update info, so [start] returns false.
 */
class PlayAppUpdater(private val context: Context) : AppUpdater {
    private val manager = AppUpdateManagerFactory.create(context)
    private val ready = MutableStateFlow(false)
    override val readyToInstall: StateFlow<Boolean> = ready.asStateFlow()

    /** Set by the Activity for its lifetime (cleared in onDestroy so it can't leak). */
    var launcher: ActivityResultLauncher<IntentSenderRequest>? = null

    private val listener = InstallStateUpdatedListener { state ->
        if (state.installStatus() == InstallStatus.DOWNLOADED) ready.value = true
    }

    init {
        manager.registerListener(listener)
    }

    override suspend fun start(immediate: Boolean, gate: VersionGate): Boolean {
        val target = launcher ?: return false
        val info = runCatching { manager.appUpdateInfo.await() }.getOrNull() ?: return false
        if (info.installStatus() == InstallStatus.DOWNLOADED) {
            ready.value = true
            return true
        }
        val type = if (immediate) AppUpdateType.IMMEDIATE else AppUpdateType.FLEXIBLE
        val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
            info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
        if (!available || !info.isUpdateTypeAllowed(type)) return false
        return withContext(Dispatchers.Main) {
            runCatching { manager.startUpdateFlowForResult(info, target, AppUpdateOptions.newBuilder(type).build()) }.getOrDefault(false)
        }
    }

    override fun install() {
        manager.completeUpdate()
    }

    override fun openStore() {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(market)
        } catch (_: ActivityNotFoundException) {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
