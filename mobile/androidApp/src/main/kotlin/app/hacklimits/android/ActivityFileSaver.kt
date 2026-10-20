package app.hacklimits.android

import android.content.Context
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import app.hacklimits.shared.platform.FileSaver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Saves through the system "Save to" picker (Storage Access Framework): no storage permission, and
 * the person chooses the place. MainActivity owns the picker launcher and hands results back here.
 */
class ActivityFileSaver(private val context: Context) : FileSaver {
    var launcher: ActivityResultLauncher<String>? = null
    private var pending: CompletableDeferred<Uri?>? = null

    fun onPicked(uri: Uri?) {
        pending?.complete(uri)
        pending = null
    }

    override suspend fun save(suggestedName: String, mimeType: String, bytes: ByteArray): Boolean {
        val picker = launcher ?: return false
        val result = CompletableDeferred<Uri?>()
        pending?.complete(null)
        pending = result
        withContext(Dispatchers.Main) { picker.launch(suggestedName) }
        val uri = result.await() ?: return false
        return withContext(Dispatchers.IO) {
            runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } != null }.getOrDefault(false)
        }
    }
}
