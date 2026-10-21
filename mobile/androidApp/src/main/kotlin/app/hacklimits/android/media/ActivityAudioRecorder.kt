package app.hacklimits.android.media

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import app.hacklimits.shared.media.AudioRecorder
import app.hacklimits.shared.media.RecordedAudio
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Records a short voice note (AAC) for server-side transcription. Only used on phones without the
 * system speech recognizer; elsewhere voice input stays on-device (ActivitySpeechInput). The clip
 * is sent once for transcription and the local file is deleted right after.
 */
class ActivityAudioRecorder(private val context: Context) : AudioRecorder {
    /** Set by the Activity: asks for RECORD_AUDIO and reports the answer through [onPermission]. */
    var requestPermission: (() -> Unit)? = null
    private var pendingPermission: CompletableDeferred<Boolean>? = null
    private var recorder: MediaRecorder? = null
    private val file by lazy { File(context.cacheDir, "voice.aac") }

    fun onPermission(granted: Boolean) {
        pendingPermission?.complete(granted)
        pendingPermission = null
    }

    override suspend fun start(): Boolean {
        if (recorder != null || !ensurePermission()) return false
        return withContext(Dispatchers.IO) {
            runCatching {
                file.delete()
                @Suppress("DEPRECATION")
                val created = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
                recorder = created.apply {
                    setAudioSource(MediaRecorder.AudioSource.MIC)
                    setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
                    setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                    setAudioSamplingRate(16_000)
                    setAudioEncodingBitRate(32_000)
                    // The server stops at ~4 MB; 60 s at 32 kbps is about 240 KB.
                    setMaxDuration(60_000)
                    setOutputFile(file.path)
                    prepare()
                    start()
                }
                true
            }.getOrElse {
                release()
                false
            }
        }
    }

    override suspend fun stop(): RecordedAudio? = withContext(Dispatchers.IO) {
        val active = recorder ?: return@withContext null
        val stopped = runCatching { active.stop() }.isSuccess // throws when nothing was captured
        release()
        val bytes = if (stopped && file.exists()) file.readBytes() else null
        file.delete()
        bytes?.takeIf { it.isNotEmpty() }?.let { RecordedAudio(it, "audio/aac", "aac") }
    }

    private suspend fun ensurePermission(): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return true
        val ask = requestPermission ?: return false
        val answer = CompletableDeferred<Boolean>()
        pendingPermission?.complete(false)
        pendingPermission = answer
        withContext(Dispatchers.Main) { ask() }
        return answer.await()
    }

    private fun release() {
        runCatching { recorder?.release() }
        recorder = null
    }
}
