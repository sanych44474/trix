package app.hacklimits.android.health

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import app.hacklimits.android.BuildConfig

/**
 * Health Connect opens this when the person asks why the app wants step data. It shows the privacy
 * policy (which explains the step-count use) in the browser and closes.
 */
class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = BuildConfig.PRIVACY_POLICY_URL.ifBlank { "${BuildConfig.API_BASE_URL.trimEnd('/')}/privacy.html" }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        finish()
    }
}
