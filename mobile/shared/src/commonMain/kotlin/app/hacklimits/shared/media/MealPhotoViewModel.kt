package app.hacklimits.shared.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.platform.PhotoPicker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Local failure codes; API failures keep the server's code (rate_limited, dependency_unavailable, ...). */
internal const val FAULT_NETWORK = "network"
internal const val FAULT_UNREADABLE = "unreadable"
internal const val FAULT_GRAMS = "grams"
internal const val FAULT_SPEECH = "speech"
internal const val FAULT_SPEECH_EMPTY = "speech_empty"

@OptIn(ExperimentalUuidApi::class)
internal class MealPhotoViewModel(
    private val api: MediaApi,
    private val photos: PhotoPicker,
    private val speech: SpeechInput,
    private val platform: AppPlatform,
) : ViewModel() {
    data class State(
        val draft: List<DraftItem> = emptyList(),
        val estimated: Boolean = false,
        val busy: Boolean = false,
        val listening: Boolean = false,
        val text: String = "",
        val error: String? = null,
        val done: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /** Without a platform recogniser the mic button is not shown at all. */
    val micAvailable: Boolean = speech !is NoSpeechInput

    // Reused across a retry of the same confirmation, so a dropped response cannot log it twice.
    // Dropped as soon as the items change, since a replay would return the old request's result.
    private var logKey: String? = null
    private var textKey: String? = null

    fun choosePhoto() = call {
        val photo = photos.pick() ?: return@call
        val items = api.estimateMealPhoto(photo.bytes, photo.mimeType).take(MAX_MEAL_ITEMS)
        logKey = null
        _state.update { s ->
            s.copy(
                draft = items.map { DraftItem(it, it.grams?.let(::formatGrams).orEmpty()) },
                estimated = true,
            )
        }
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
