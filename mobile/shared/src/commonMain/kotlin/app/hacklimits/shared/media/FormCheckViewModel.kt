package app.hacklimits.shared.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Why a clip was not checked: a local gate code (too_big, too_long), a server reason (limit, failed) or "generic". */
internal data class FormNote(val code: String, val limit: Int? = null)

internal const val NOTE_GENERIC = "generic"
private const val FORM_CHECK_DEFAULT_LIMIT = 5

internal class FormCheckViewModel(
    private val api: MediaApi,
    private val files: MediaFilePicker,
    private val telemetry: Telemetry,
) : ViewModel() {
    data class State(
        val caption: String = "",
        val busy: Boolean = false,
        val answer: String? = null,
        val note: FormNote? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun onCaption(value: String) = _state.update { it.copy(caption = value.take(120)) }

    /** Prefills the exercise name when the screen was opened from an exercise. */
    fun presetCaption(exercise: String) {
        if (_state.value.caption.isEmpty()) onCaption(exercise)
    }

    fun checkClip() {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(answer = null, note = null) }
            try {
                val file = files.pick(MediaFileKind.VIDEO) ?: return@launch
                // Size and length first: a 200 MB clip is refused before anything is read or sent.
                val gate = clipGate(file.sizeBytes, file.seconds)
                if (gate != ClipGate.OK) {
                    _state.update { it.copy(note = FormNote(if (gate == ClipGate.TOO_BIG) "too_big" else "too_long")) }
                    return@launch
                }
                _state.update { it.copy(busy = true) }
                val r = api.formCheck(file.bytes(), file.mimeType, _state.value.caption, file.seconds)
                val text = r.text?.takeIf { r.ok && it.isNotBlank() }
                if (text != null) {
                    _state.update { it.copy(answer = text) }
                    telemetry.track("app_form_check")
                } else {
                    _state.update { it.copy(note = FormNote(r.reason ?: "failed", r.limit ?: FORM_CHECK_DEFAULT_LIMIT)) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(note = FormNote(NOTE_GENERIC)) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
