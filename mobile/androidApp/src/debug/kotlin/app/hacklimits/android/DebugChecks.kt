package app.hacklimits.android

import android.os.StrictMode

/** Debug builds only: disk/network on the main thread and leaked closeables show up in logcat
 * (LeakCanary, a debug-only dependency, watches Activities, ViewModels and Fragments by itself). */
object DebugChecks {
    fun install() {
        StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
        StrictMode.setVmPolicy(StrictMode.VmPolicy.Builder().detectAll().penaltyLog().build())
    }
}
