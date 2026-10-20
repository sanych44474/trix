package app.hacklimits.android

import android.content.Context
import app.hacklimits.shared.data.ClientErrorApi
import app.hacklimits.shared.platform.ErrorReporter
import com.google.firebase.crashlytics.FirebaseCrashlytics
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Unexpected failures go to Crashlytics (when Firebase is configured) and to the server's error
 * log, which feeds the owner report. A crash is written down synchronously before the process dies
 * and sent on the next launch. Only exception types and messages leave the device, capped per run.
 */
class NativeErrorReporter(context: Context, private val api: () -> ClientErrorApi) : ErrorReporter {
    private val prefs = context.getSharedPreferences("errors", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val crashlytics = runCatching { FirebaseCrashlytics.getInstance() }.getOrNull()
    private val sent = HashSet<String>()

    override fun record(error: Throwable, where: String) {
        crashlytics?.recordException(error)
        send(summary(error), where)
    }

    /** Chains in front of the existing handler (Crashlytics') so both see the crash. */
    fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                prefs.edit().putString(LAST_CRASH, summary(error)).putString(LAST_CRASH_AT, topFrame(error)).commit()
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Sends the crash saved by the previous run, once someone is signed in to attribute it. */
    fun flushLastCrash() {
        val message = prefs.getString(LAST_CRASH, null) ?: return
        val where = prefs.getString(LAST_CRASH_AT, null) ?: "crash"
        prefs.edit().remove(LAST_CRASH).remove(LAST_CRASH_AT).apply()
        send("Crash: $message", where)
    }

    // Called from network and UI threads alike.
    @Synchronized
    private fun send(message: String, where: String) {
        if (sent.size >= MAX_PER_RUN || !sent.add("$message@$where")) return
        scope.launch { api().report(message, where) }
    }

    private fun summary(error: Throwable): String {
        val root = generateSequence(error) { it.cause }.last()
        return "${root::class.simpleName}: ${root.message.orEmpty()}".take(160)
    }

    /** The first app frame: enough to find the bug without shipping a stack trace. */
    private fun topFrame(error: Throwable): String {
        val frame = generateSequence(error) { it.cause }.flatMap { it.stackTrace.asSequence() }
            .firstOrNull { it.className.startsWith("app.hacklimits") } ?: return "crash"
        return "${frame.className.substringAfterLast('.')}.${frame.methodName}:${frame.lineNumber}"
    }

    private companion object {
        const val LAST_CRASH = "last_crash"
        const val LAST_CRASH_AT = "last_crash_at"
        const val MAX_PER_RUN = 10
    }
}
