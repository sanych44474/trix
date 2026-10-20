package app.hacklimits.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.hacklimits.shared.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

/**
 * DEBUG BUILDS ONLY (src/debug): lets an emulator test sign in against a local `wrangler dev` with a
 * session created in the local database, since email, Google and Telegram sign-in need live
 * services. Release builds do not contain this class or its manifest entry.
 *
 *   adb shell am broadcast -n app.hacklimits/app.hacklimits.android.DevSessionReceiver --es token <64 hex>
 */
class DevSessionReceiver : BroadcastReceiver(), KoinComponent {
    private val sessions: SessionStore by inject()

    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra("token")?.takeIf { Regex("^[0-9a-f]{64}$").matches(it) } ?: return
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try { sessions.save(token) } finally { done.finish() }
        }
    }
}
