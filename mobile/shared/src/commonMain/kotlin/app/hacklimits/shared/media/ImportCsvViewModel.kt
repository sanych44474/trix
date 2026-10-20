package app.hacklimits.shared.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class ImportCsvViewModel(
    private val api: MediaApi,
    private val files: MediaFilePicker,
    private val telemetry: Telemetry,
) : ViewModel() {
    data class Done(val imported: Int, val skipped: Int, val capped: Boolean, val cap: Int)

    /** `done` after a successful import; otherwise `note` holds a reason code (too_big, wrong_format, failed, generic). */
    data class State(val busy: Boolean = false, val done: Done? = null, val note: String? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun pickCsv() {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(done = null, note = null) }
            try {
                val file = files.pick(MediaFileKind.CSV) ?: return@launch
                if (file.sizeBytes > MAX_CSV_BYTES) {
                    _state.update { it.copy(note = "too_big") }
                    return@launch
                }
                _state.update { it.copy(busy = true) }
                val r = api.importCsv(file.bytes())
                if (r.ok) {
                    _state.update { it.copy(done = Done(r.imported, r.skipped, r.capped, r.cap)) }
                    telemetry.track("app_csv_import")
                } else {
                    _state.update { it.copy(note = r.reason ?: "failed") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(note = NOTE_GENERIC) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
