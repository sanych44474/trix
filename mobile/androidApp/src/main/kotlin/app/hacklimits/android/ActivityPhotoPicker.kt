package app.hacklimits.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import app.hacklimits.shared.platform.PhotoPicker
import app.hacklimits.shared.platform.PickedPhoto
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The system photo picker (no storage permission) plus a resize to at most 2048 px and JPEG 85:
 * a phone photo drops from several MB to a few hundred KB, well under the server's 10 MB limit,
 * and EXIF (location, device) is not carried over because the image is re-encoded.
 */
class ActivityPhotoPicker(private val context: Context) : PhotoPicker {
    var launch: (() -> Unit)? = null
    private var pending: CompletableDeferred<Uri?>? = null

    fun onPicked(uri: Uri?) {
        pending?.complete(uri)
        pending = null
    }

    override suspend fun pick(): PickedPhoto? {
        val start = launch ?: return null
        val result = CompletableDeferred<Uri?>()
        pending?.complete(null)
        pending = result
        withContext(Dispatchers.Main) { start() }
        val uri = result.await() ?: return null
        return withContext(Dispatchers.IO) { runCatching { PickedPhoto(resize(uri), "image/jpeg") }.getOrNull() }
    }

    private fun resize(uri: Uri): ByteArray {
        val bitmap: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                val longest = max(info.size.width, info.size.height)
                if (longest > MAX_EDGE) decoder.setTargetSize(info.size.width * MAX_EDGE / longest, info.size.height * MAX_EDGE / longest)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_EDGE) sample *= 2
            context.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })!! }
        }
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray()
        }
    }

    private companion object { const val MAX_EDGE = 2048 }
}
