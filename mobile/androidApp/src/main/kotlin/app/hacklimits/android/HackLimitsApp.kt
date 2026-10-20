package app.hacklimits.android

import android.app.Activity
import android.app.Application
import android.os.Bundle
import app.hacklimits.shared.auth.GoogleSignIn
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.di.sharedModule
import app.hacklimits.shared.platform.AppPlatform
import java.lang.ref.WeakReference
import java.util.Locale
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.dsl.module

class HackLimitsApp : Application() {
    /** Credential Manager needs the visible Activity; held weakly so it can't leak. */
    private var current: WeakReference<Activity>? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacksAdapter() {
            override fun onActivityResumed(activity: Activity) { current = WeakReference(activity) }
            override fun onActivityPaused(activity: Activity) { if (current?.get() === activity) current = null }
        })
        val platform = object : AppPlatform {
            override val language: String get() = if (Locale.getDefault().language == "uk") "uk" else "en"
            override val appVersion: String = BuildConfig.VERSION_NAME
            override val pushPlatform: String = "android"
        }
        startKoin {
            androidContext(this@HackLimitsApp)
            modules(
                sharedModule(BuildConfig.API_BASE_URL),
                module {
                    single<AppPlatform> { platform }
                    single<SessionStore> { KeystoreSessionStore(get()) }
                    single<GoogleSignIn> { CredentialGoogleSignIn { current?.get() } }
                    single { PushRegistrar(get(), get(), get(), get()) }
                },
            )
        }
    }
}

private open class ActivityLifecycleCallbacksAdapter : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
