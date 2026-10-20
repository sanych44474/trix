package app.hacklimits.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import app.hacklimits.shared.App
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val pushRegistrar: PushRegistrar by inject()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { App(onSignedIn = ::onSignedIn, beforeSignOut = pushRegistrar::unregister) }
    }

    /** Ask for notifications only once someone is signed in and reminders mean something. */
    private fun onSignedIn() {
        if (!pushRegistrar.available()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        pushRegistrar.registerCurrentToken()
    }
}
