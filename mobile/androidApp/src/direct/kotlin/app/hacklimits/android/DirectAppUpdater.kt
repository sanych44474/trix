package app.hacklimits.android

import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import app.hacklimits.shared.update.ApkDownload
import app.hacklimits.shared.update.AppUpdater
import app.hacklimits.shared.update.VersionGate
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal fun storeUpdater(context: Context): AppUpdater = DirectAppUpdater(context)

/**
 * Self-update for APK installs: download the published APK (/download/android) in the background,
 * accept it only if its size and SHA-256 match the server's manifest, then hand it to the system
 * installer, which shows Android's own "Update this app?" prompt. Android also refuses an APK that
 * isn't signed with this app's key, so a tampered download can't replace the app.
 */
class DirectAppUpdater(private val context: Context) : AppUpdater {
    private val ready = MutableStateFlow(false)
    override val readyToInstall: StateFlow<Boolean> = ready.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    // Lazy: cacheDir touches the disk, and the updater is built on the main thread at start-up.
    private val apk by lazy { File(context.cacheDir, "updates/update.apk") }
    private var downloaded: ApkDownload? = null
    private var pageUrl: String? = null

    override suspend fun start(immediate: Boolean, gate: VersionGate): Boolean {
        val download = gate.download ?: return false
        pageUrl = download.url
        if (download.versionCode <= BuildConfig.VERSION_CODE) {
            // Already on it (the previous download was installed): drop the leftover file.
            withContext(Dispatchers.IO) { apk.delete() }
            return false
        }
        if (!allowedUrl(download.url)) return false
        val ok = lock.withLock { (downloaded == download && apk.exists()) || fetch(download) }
        if (!ok) return false
        downloaded = download
        ready.value = true
        if (immediate) install()
        return true
    }

    override fun install() {
        if (!ready.value || !apk.exists()) return
        // "Install unknown apps" is per app and off by default: send the user to the switch once.
        if (!context.packageManager.canRequestPackageInstalls()) {
            launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            return
        }
        scope.launch { runCatching { commitSession() } }
    }

    override fun openStore() {
        pageUrl?.let { launch(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
    }

    private fun commitSession() {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("update.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // Mutable: the installer fills in the status extras, including the confirmation intent.
            val status = PendingIntent.getBroadcast(
                context, id, Intent(context, InstallStatusReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(status.intentSender)
        }
    }

    private suspend fun fetch(download: ApkDownload): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            apk.parentFile?.mkdirs()
            val part = File(apk.path + ".part")
            val connection = (URL(download.url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 60_000
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            try {
                if (connection.responseCode != 200) return@runCatching false
                connection.inputStream.use { input ->
                    part.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            total += n
                            if (total > download.size) return@runCatching false
                            digest.update(buffer, 0, n)
                            output.write(buffer, 0, n)
                        }
                    }
                }
            } finally {
                connection.disconnect()
            }
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (total != download.size || sha != download.sha256) {
                part.delete()
                false
            } else {
                apk.delete()
                part.renameTo(apk)
            }
        }.getOrDefault(false)
    }

    /** HTTPS only; debug builds may also use the local wrangler dev server. */
    private fun allowedUrl(url: String): Boolean =
        url.startsWith("https://") || (BuildConfig.DEBUG && url.startsWith("http://10.0.2.2:"))

    private fun launch(intent: Intent) {
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
        }
    }
}

/** The installer's answer: when it needs the user's OK, show Android's confirmation screen. */
class InstallStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE) != PackageInstaller.STATUS_PENDING_USER_ACTION) return
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
        try {
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
