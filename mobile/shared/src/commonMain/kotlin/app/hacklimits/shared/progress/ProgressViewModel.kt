package app.hacklimits.shared.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.HistoryItem
import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.Records
import app.hacklimits.shared.platform.PhotoPicker
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Progress: body weight trend and logging, personal records, recent workouts, progress photos. */
@OptIn(ExperimentalUuidApi::class)
class ProgressViewModel(
    private val progress: ProgressApi,
    private val dashboard: DashboardApi,
    private val api: ApiClient,
    private val picker: PhotoPicker,
) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val weight: Dashboard.Weight = Dashboard.Weight(),
        val records: Records = Records(),
        val history: List<HistoryItem> = emptyList(),
        val photos: List<PhotoRef> = emptyList(),
        val bearer: String? = null,
        val weightInput: String = "",
        val busy: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun photoUrl(id: Long) = progress.photoUrl(id)

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(error = null) }
            try {
                coroutineScope {
                    val d = async { dashboard.load() }
                    val r = async { runCatching { progress.records() }.getOrDefault(Records()) }
                    val h = async { runCatching { progress.history() }.getOrDefault(emptyList()) }
                    val p = async { runCatching { progress.photos() }.getOrDefault(emptyList()) }
                    _state.update {
                        it.copy(loading = false, weight = d.await().weight, records = r.await(), history = h.await(),
                            photos = p.await(), bearer = api.bearer())
                    }
                }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "network") }
            }
        }
    }

    fun onWeight(value: String) = _state.update { it.copy(weightInput = value.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(6)) }

    fun logWeight() {
        val kg = _state.value.weightInput.replace(',', '.').toDoubleOrNull() ?: return
        if (kg !in 25.0..400.0) { _state.update { it.copy(error = "invalid_weight") }; return }
        act { progress.logWeight(kg, Uuid.random().toString()); _state.update { it.copy(weightInput = "") }; refresh() }
    }

    fun addPhoto() = act {
        val photo = picker.pick() ?: return@act
        progress.uploadPhoto(photo.bytes, photo.mimeType)
        refresh()
    }

    private fun act(block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try { block() }
            catch (e: ApiException) { _state.update { it.copy(error = e.code) } }
            catch (e: Exception) { _state.update { it.copy(error = "network") } }
            finally { _state.update { it.copy(busy = false) } }
        }
    }
}
