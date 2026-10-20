package app.hacklimits.shared.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.platform.PhotoPicker
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Local failure codes; API failures keep the server's code (rate_limited, limit, dependency_unavailable, ...). */
internal const val FAULT_NETWORK = "network"
internal const val FAULT_UNREADABLE = "unreadable"
internal const val FAULT_GRAMS = "grams"
internal const val FAULT_SPEECH = "speech"
internal const val FAULT_SPEECH_EMPTY = "speech_empty"
internal const val FAULT_NO_MIC = "no_mic"
internal const val FAULT_UNCLEAR = "unclear"

/** The server's own code for "today's photo estimates are used up" (a 429 with error "limit"). */
internal const val CODE_PHOTO_LIMIT = "limit"

private const val MIN_VOICE_BYTES = 1000

@OptIn(ExperimentalUuidApi::class)
internal class MealPhotoViewModel(
    private val api: MediaApi,
    private val photos: PhotoPicker,
    private val speech: SpeechInput,
    private val platform: AppPlatform,
    private val telemetry: Telemetry,
    /** Used only when on-device speech is not available; null leaves the record button out. */
    private val recorder: AudioRecorder? = null,
) : ViewModel() {
    data class State(
        val draft: List<DraftItem> = emptyList(),
        val estimated: Boolean = false,
        val busy: Boolean = false,
        val listening: Boolean = false,
        val recording: Boolean = false,
        val caption: String = "",
        val text: String = "",
        val error: String? = null,
        val done: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /** Without a platform recogniser the mic button is not shown at all. */
    val micAvailable: Boolean = speech !is NoSpeechInput

    /** Record-and-transcribe stands in for the on-device mic when recognition is not bound. */
    val recordAvailable: Boolean = !micAvailable && recorder != null

    // Reused across a retry of the same confirmation, so a dropped response cannot log it twice.
    // Dropped as soon as the items change, since a replay would return the old request's result.
    private var logKey: String? = null
    private var textKey: String? = null

    fun onCaption(value: String) = _state.update { it.copy(caption = value.take(200)) }

    fun choosePhoto() = call {
        val photo = photos.pick() ?: return@call
        val items = api.estimateMealPhoto(photo.bytes, photo.mimeType, _state.value.caption).take(MAX_MEAL_ITEMS)
        logKey = null
        _state.update { s ->
            s.copy(
                draft = items.map { DraftItem(it, it.grams?.let(::formatGrams).orEmpty()) },
                estimated = true,
            )
        }
        telemetry.track("app_meal_photo")
    }

    fun removeItem(index: Int) {
        logKey = null
        _state.update { s -> s.copy(draft = s.draft.filterIndexed { i, _ -> i != index }) }
    }

    /** Drops the photo estimate and its caption, as the Mini App's close does. */
    fun reset() {
        logKey = null
        _state.update { it.copy(draft = emptyList(), estimated = false, caption = "", error = null) }
    }

    fun onGrams(index: Int, value: String) {
        logKey = null
        _state.update { s ->
            val cleaned = value.filter { it.isDigit() || it == '.' }.take(7)
            s.copy(draft = s.draft.mapIndexed { i, d -> if (i == index) d.copy(gramsText = cleaned) else d })
        }
    }

    fun logItems() {
        val s = _state.value
        if (s.draft.isEmpty()) return
        if (!s.draft.all { isValidGrams(it.gramsText) }) return fail(FAULT_GRAMS)
        val logged = s.draft.map { it.toLogged() }
        val key = logKey ?: Uuid.random().toString().also { logKey = it }
        call {
            api.addItems(logged, key)
            _state.update { it.copy(done = true) }
        }
    }

    fun onText(value: String) = _state.update { it.copy(text = value.take(500)) }

    fun logText() {
        val text = _state.value.text.trim().takeIf { it.length >= 2 } ?: return
        val key = textKey ?: Uuid.random().toString().also { textKey = it }
        call {
            if (api.logFoodText(text, key)) {
                textKey = null
                _state.update { it.copy(done = true) }
            } else {
                fail(FAULT_UNREADABLE)
            }
        }
    }

    fun dictate() {
        if (!micAvailable || _state.value.listening) return
        viewModelScope.launch {
            _state.update { it.copy(listening = true, error = null) }
            try {
                val heard = speech.listen(platform.language)?.trim()?.takeIf { it.isNotEmpty() }
                if (heard == null) fail(FAULT_SPEECH_EMPTY)
                else _state.update { it.copy(text = (it.text + " " + heard).trim().take(500)) }
            } catch (e: Exception) {
                fail(FAULT_SPEECH)
            } finally {
                _state.update { it.copy(listening = false) }
            }
        }
    }

    /** First tap starts the recorder; second tap stops it and sends the clip for transcription. */
    fun toggleRecording() {
        val rec = recorder ?: return
        val s = _state.value
        if (!recordAvailable || s.busy || s.listening) return
        viewModelScope.launch {
            if (!s.recording) {
                _state.update { it.copy(error = null) }
                if (rec.start()) _state.update { it.copy(recording = true) } else fail(FAULT_NO_MIC)
                return@launch
            }
            _state.update { it.copy(recording = false, busy = true) }
            try {
                val clip = rec.stop()
                if (clip == null || clip.bytes.size < MIN_VOICE_BYTES) {
                    fail(FAULT_SPEECH_EMPTY)
                } else {
                    val heard = api.transcribe(clip.bytes, clip.mimeType, clip.fileExtension).trim()
                    if (heard.isEmpty()) {
                        fail(FAULT_UNCLEAR)
                    } else {
                        _state.update { it.copy(text = (it.text + " " + heard).trim().take(500)) }
                        telemetry.track("app_voice_ok")
                    }
                }
            } catch (e: ApiException) {
                fail(e.code)
            } catch (e: Exception) {
                fail(FAULT_NETWORK)
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    private fun fail(code: String) = _state.update { it.copy(error = code) }

    private fun call(block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                block()
            } catch (e: ApiException) {
                fail(e.code)
            } catch (e: Exception) {
                fail(FAULT_NETWORK)
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
