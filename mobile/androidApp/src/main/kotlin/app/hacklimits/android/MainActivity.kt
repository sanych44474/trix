package app.hacklimits.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import app.hacklimits.android.health.HealthConnectSync
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import app.hacklimits.shared.App
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val pushRegistrar: PushRegistrar by inject()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val fileSaver: ActivityFileSaver by inject()
    private val photoPicker: ActivityPhotoPicker by inject()
    private val speechInput: ActivitySpeechInput by inject()
    private val recognizeSpeech = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        speechInput.onResult(result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull())
    }
    // The Integrations screen re-checks the grant when it resumes, so the result needs no handling.
    private val healthPermission = registerForActivityResult(HealthConnectSync.permissionContract()) {}
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> photoPicker.onPicked(uri) }
    // MIME type is a placeholder: the picker only needs a name, and the bytes decide the content.
    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri -> fileSaver.onPicked(uri) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        fileSaver.launcher = createDocument
        speechInput.launch = { intent -> recognizeSpeech.launch(intent) }
        photoPicker.launch = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        setContent {
            App(
                onSignedIn = ::onSignedIn,
                beforeSignOut = pushRegistrar::unregister,
                onRequestHealthPermission = { healthPermission.launch(HealthConnectSync.PERMISSIONS) },
            )
        }
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
