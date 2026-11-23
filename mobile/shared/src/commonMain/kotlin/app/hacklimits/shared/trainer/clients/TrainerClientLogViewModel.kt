package app.hacklimits.shared.trainer.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.PlanEdit
import app.hacklimits.shared.media.AudioRecorder
import app.hacklimits.shared.media.MediaApi
import app.hacklimits.shared.media.NoSpeechInput
import app.hacklimits.shared.media.SpeechInput
import app.hacklimits.shared.platform.AppPlatform
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * The trainer logs a client's workout, or speaks a command that becomes a proposal (sets for this
 * form, or edits to the client's plan); nothing is applied until the trainer taps (ADR-0018).
 * Online only: it never touches the client's draft or this phone's offline queue, and a save is
 * checked against the day as it was loaded, so the client's own log is never wiped.
 */
@OptIn(ExperimentalUuidApi::class)
internal class TrainerClientLogViewModel(
    private val api: TrainerLogApi,
    private val planApi: PlanApi,
    private val speech: SpeechInput,
    private val media: MediaApi,
    private val platform: AppPlatform,
    private val clientId: Long,
    /** Used only when on-device speech is not available; null leaves the record button out. */
    private val recorder: AudioRecorder? = null,
) : ViewModel() {
    enum class Notice { Saved, Stale, Nothing, PlanApplied, PlanFailed, PlanInjury, SlowDown, Failed, SpeechEmpty, NoMic }

    data class State(
        val day: TrainerLogDay? = null,
        val loadFailed: Boolean = false,
        val form: List<FormExercise> = emptyList(),
        val voiceText: String = "",
        val proposal: VoiceProposal? = null,
        val busy: Boolean = false,
        val listening: Boolean = false,
        val recording: Boolean = false,
        val notice: Notice? = null,
        /** Exercises that set a record in the last save, and plan changes applied, for the notice. */
        val prs: List<String> = emptyList(),
        val applied: Int = 0,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    val micAvailable: Boolean = speech !is NoSpeechInput
    val recordAvailable: Boolean = !micAvailable && recorder != null

    // One key per logical save / suggestion, reused by a retry after a lost response.
    private var saveKey: String? = null
    private var voiceKey: String? = null

    init { load(null) }

    fun load(date: String?) {
        viewModelScope.launch {
            _state.update { it.copy(loadFailed = false) }
            try {
                val day = api.day(clientId, date)
                saveKey = null
                _state.update { it.copy(day = day, form = formFromDay(day)) }
            } catch (e: Exception) {
                _state.update { it.copy(loadFailed = true) }
            }
        }
    }

    fun onCell(exercise: Int, row: Int, field: String, value: String) {
        saveKey = null
        _state.update { it.copy(form = editCell(it.form, exercise, row, field, value), notice = null) }
    }

    fun onAddRow(exercise: Int) {
        saveKey = null
        _state.update { it.copy(form = addRow(it.form, exercise)) }
    }

    fun onAddExercise(name: String) {
        saveKey = null
        _state.update { it.copy(form = addExercise(it.form, name)) }
    }

    fun onVoiceText(value: String) {
        voiceKey = null
        _state.update { it.copy(voiceText = value.take(1000)) }
    }

    fun dismissNotice() = _state.update { it.copy(notice = null) }

    fun save() {
        val s = _state.value
        val day = s.day ?: return
        if (s.busy) return
        val entries = formEntries(s.form)
        if (entries.isEmpty()) return _state.update { it.copy(notice = Notice.Nothing) }
        val key = saveKey ?: Uuid.random().toString().also { saveKey = it }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, notice = null) }
            try {
                val r = api.save(clientId, day.date, entries, day.savedAt, key)
                saveKey = null
                _state.update { it.copy(day = day.copy(savedAt = r.savedAt, savedByTrainer = true), notice = Notice.Saved, prs = r.prExercises) }
            } catch (e: ApiException) {
                if (e.status == 409) {
                    _state.update { it.copy(notice = Notice.Stale) }
                    load(day.date)
                } else _state.update { it.copy(notice = Notice.Failed) }
            } catch (e: Exception) {
                _state.update { it.copy(notice = Notice.Failed) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    fun suggest() {
        val s = _state.value
        val text = s.voiceText.trim()
        if (text.isEmpty() || s.busy) return
        val key = voiceKey ?: Uuid.random().toString().also { voiceKey = it }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, notice = null, proposal = null) }
            try {
                val proposal = api.voice(clientId, text, s.day?.date, key)
                voiceKey = null
                _state.update { it.copy(proposal = proposal) }
            } catch (e: ApiException) {
                _state.update { it.copy(notice = if (e.status == 429) Notice.SlowDown else Notice.Failed) }
            } catch (e: Exception) {
                _state.update { it.copy(notice = Notice.Failed) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    /** The spoken sets go into the form; the trainer still saves. */
    fun applyWorkout() {
        val p = _state.value.proposal ?: return
        saveKey = null
        _state.update { it.copy(form = mergeProposal(it.form, p.entries), proposal = null, voiceText = "") }
    }

    /** Plan changes go through the plan editor one by one, in the server's order; the first refusal stops. */
    fun applyPlan() {
        val s = _state.value
        val p = s.proposal ?: return
        val version = p.version ?: return
        if (s.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, notice = null) }
            var applied = 0
            try {
                for (a in p.actions) {
                    val action = planActionFor(a.kind) ?: continue
                    val weekday = a.weekday ?: continue
                    val value = if (a.kind == "swap" || a.kind == "add") a.exercise else a.value
                    planApi.edit(PlanEdit(action = action, weekday = weekday, index = a.index ?: -1, value = value, expectName = a.target, clientId = clientId), version)
                    applied++
                }
                _state.update { it.copy(proposal = null, notice = Notice.PlanApplied, applied = applied) }
            } catch (e: ApiException) {
                val injury = e.message?.startsWith("injury:") == true
                _state.update { it.copy(notice = if (injury) Notice.PlanInjury else Notice.PlanFailed, applied = applied) }
            } catch (e: Exception) {
                _state.update { it.copy(notice = Notice.PlanFailed, applied = applied) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    fun dictate() {
        if (!micAvailable || _state.value.listening) return
        viewModelScope.launch {
            _state.update { it.copy(listening = true, notice = null) }
            try {
                val heard = speech.listen(platform.language)?.trim()?.takeIf { it.isNotEmpty() }
                if (heard == null) _state.update { it.copy(notice = Notice.SpeechEmpty) }
                else appendVoice(heard)
            } catch (e: Exception) {
                _state.update { it.copy(notice = Notice.SpeechEmpty) }
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
                if (rec.start()) _state.update { it.copy(recording = true, notice = null) } else _state.update { it.copy(notice = Notice.NoMic) }
                return@launch
            }
            _state.update { it.copy(recording = false, busy = true) }
            try {
                val clip = rec.stop()
                val heard = if (clip == null || clip.bytes.size < MIN_VOICE_BYTES) "" else media.transcribe(clip.bytes, clip.mimeType, clip.fileExtension).trim()
                if (heard.isEmpty()) _state.update { it.copy(notice = Notice.SpeechEmpty) } else appendVoice(heard)
            } catch (e: ApiException) {
                _state.update { it.copy(notice = if (e.status == 429) Notice.SlowDown else Notice.Failed) }
            } catch (e: Exception) {
                _state.update { it.copy(notice = Notice.Failed) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    private fun appendVoice(heard: String) {
        voiceKey = null
        _state.update { it.copy(voiceText = (if (it.voiceText.isBlank()) heard else it.voiceText + "\n" + heard).take(1000)) }
    }

    private companion object {
        const val MIN_VOICE_BYTES = 1000
    }
}
