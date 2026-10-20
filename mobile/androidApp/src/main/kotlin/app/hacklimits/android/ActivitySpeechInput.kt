package app.hacklimits.android

import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import app.hacklimits.shared.media.SpeechInput
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Voice input through the system speech recognizer, preferring on-device recognition: no audio
 * reaches our server and no RECORD_AUDIO permission is needed (the system UI records).
 */
class ActivitySpeechInput(private val context: Context) : SpeechInput {
    var launch: ((Intent) -> Unit)? = null
    private var pending: CompletableDeferred<String?>? = null

    fun onResult(text: String?) {
        pending?.complete(text)
        pending = null
    }

    override suspend fun listen(languageTag: String): String? {
        val start = launch ?: return null
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return null
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        val result = CompletableDeferred<String?>()
        pending?.complete(null)
        pending = result
        withContext(Dispatchers.Main) { start(intent) }
        return result.await()
    }
}
