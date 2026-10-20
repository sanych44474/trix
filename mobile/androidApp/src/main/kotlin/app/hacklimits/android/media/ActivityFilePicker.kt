package app.hacklimits.android.media

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import app.hacklimits.shared.media.MediaFileKind
import app.hacklimits.shared.media.MediaFilePicker
import app.hacklimits.shared.media.PickedFile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The system document / video picker for form-check clips and CSV exports. No storage permission is
 * needed: the picker grants read access to the single file chosen. Size and duration are read from
 * the provider before the bytes, so the shared code can refuse an oversize clip without loading it.
 *
 * Wiring (done by the Activity, not here): `registerForActivityResult(GetContent()) { filePicker.onPicked(it) }`,
 * then `filePicker.launch = { mime -> pickLauncher.launch(mime) }`; clear `launch` and call `onPicked(null)` in onDestroy.
 */
class ActivityFilePicker(private val context: Context) : MediaFilePicker {
    /** Launches the system picker for a MIME filter: any video, or any text file. */
    var launch: ((String) -> Unit)? = null
    private var pending: CompletableDeferred<Uri?>? = null

    fun onPicked(uri: Uri?) {
        pending?.complete(uri)
        pending = null
    }

    override suspend fun pick(kind: MediaFileKind): PickedFile? {
        val start = launch ?: return null
        val result = CompletableDeferred<Uri?>()
        pending?.complete(null)
        pending = result
        withContext(Dispatchers.Main) { start(if (kind == MediaFileKind.VIDEO) "video/*" else "text/*") }
        val uri = result.await() ?: return null
        return withContext(Dispatchers.IO) { describe(uri, kind) }
    }

    private fun describe(uri: Uri, kind: MediaFileKind): PickedFile {
        val resolver = context.contentResolver
        var name = "file"
        var size: Long? = null
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cursor.getString(it) ?: name }
                cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let { size = cursor.getLong(it) }
            }
        }
        // Some providers report no size in the cursor; the descriptor length is the next best answer.
        val knownSize = size?.takeIf { it >= 0 }
            ?: runCatching { resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull()?.takeIf { it >= 0 }
            ?: Long.MAX_VALUE
        val mime = resolver.getType(uri) ?: if (kind == MediaFileKind.VIDEO) "video/mp4" else "text/csv"
        val seconds = if (kind == MediaFileKind.VIDEO) durationSeconds(uri) else null
        return PickedFile(name, mime, knownSize, seconds) {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("unreadable file")
        }
    }

    private fun durationSeconds(uri: Uri): Double? = runCatching {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { it / 1000.0 }
        } finally {
            retriever.release()
        }
    }.getOrNull()
}
