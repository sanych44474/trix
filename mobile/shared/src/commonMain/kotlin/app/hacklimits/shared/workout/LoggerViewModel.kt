package app.hacklimits.shared.workout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.SaveWorkoutResult
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.data.WorkoutToday
import app.hacklimits.shared.platform.RestAlarm
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** One set row as typed: strings so a half-typed "62." survives recomposition. */
@Serializable
data class SetRow(val weight: String = "", val reps: String = "", val seconds: String = "", val meters: String = "", val done: Boolean = false)

@Serializable
data class LoggedExercise(val name: String, val metric: String, val restSec: Int, val sets: List<SetRow>)

/** The workout in progress, kept on the device so closing the app (or losing signal) loses nothing. */
@Serializable
data class WorkoutDraft(val date: String, val startedAtMs: Long, val exercises: List<LoggedExercise>)

@OptIn(ExperimentalTime::class, ExperimentalUuidApi::class)
class LoggerViewModel(
    private val api: WorkoutApi,
    private val store: KeyValueStore,
    private val pending: PendingSaves,
    private val restAlarm: RestAlarm,
) : ViewModel() {

    sealed interface State {
        data object Loading : State
        data class Error(val code: String) : State
        data object RestDay : State
        data class Logging(
            val today: WorkoutToday,
            val draft: WorkoutDraft,
            val restLeft: Int? = null,
            val saving: Boolean = false,
            val error: String? = null,
        ) : State
        data class Done(val result: SaveWorkoutResult?, val savedOffline: Boolean) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state
    private var restJob: Job? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            runCatching { pending.flush() }
            _state.value = try {
                val today = api.today()
                if (today.restDay || today.exercises.isEmpty()) State.RestDay
                else State.Logging(today, restoreOrStart(today))
            } catch (e: ApiException) {
                State.Error(e.code)
            } catch (e: Exception) {
                State.Error("network")
            }
        }
    }

    fun edit(exercise: Int, set: Int, change: (SetRow) -> SetRow) = updateDraft { d ->
        d.copy(exercises = d.exercises.mapIndexed { i, ex ->
            if (i != exercise) ex else ex.copy(sets = ex.sets.mapIndexed { j, row -> if (j == set) change(row) else row })
        })
    }

    /** Ticking a set done starts the rest countdown (and the background alarm). */
    fun toggleDone(exercise: Int, set: Int, restTitle: String, restBody: String) {
        val logging = _state.value as? State.Logging ?: return
        val nowDone = !logging.draft.exercises[exercise].sets[set].done
        edit(exercise, set) { it.copy(done = nowDone) }
        if (nowDone) startRest(logging.draft.exercises[exercise].restSec, restTitle, restBody) else stopRest()
    }

    fun addSet(exercise: Int) = updateDraft { d ->
        d.copy(exercises = d.exercises.mapIndexed { i, ex ->
            if (i != exercise) ex else ex.copy(sets = ex.sets + (ex.sets.lastOrNull()?.copy(done = false) ?: SetRow()))
        })
    }

    fun stopRest() {
        restJob?.cancel()
        restAlarm.cancel()
        _state.update { (it as? State.Logging)?.copy(restLeft = null) ?: it }
    }

    fun finish() {
        val logging = _state.value as? State.Logging ?: return
        val request = toRequest(logging.draft) ?: run {
            _state.value = logging.copy(error = "nothing_logged")
            return
        }
        stopRest()
        val key = Uuid.random().toString()
        viewModelScope.launch {
            _state.value = logging.copy(saving = true, error = null)
            _state.value = try {
                val result = api.save(request, key)
                store.remove(DRAFT_KEY)
                State.Done(result, savedOffline = false)
            } catch (e: ApiException) {
                if (e.status >= 500 || e.status == 429) queueOffline(key, request) else logging.copy(saving = false, error = e.code)
            } catch (e: Exception) {
                queueOffline(key, request)
            }
        }
    }

    private suspend fun queueOffline(key: String, request: SaveWorkoutRequest): State {
        pending.add(PendingSaves.Pending(key, request))
        store.remove(DRAFT_KEY)
        return State.Done(null, savedOffline = true)
    }

    private fun startRest(seconds: Int, title: String, body: String) {
        restJob?.cancel()
        restAlarm.schedule(seconds, title, body)
        restJob = viewModelScope.launch {
            for (left in seconds downTo 0) {
                _state.update { (it as? State.Logging)?.copy(restLeft = left) ?: it }
                if (left > 0) delay(1_000)
            }
            _state.update { (it as? State.Logging)?.copy(restLeft = null) ?: it }
        }
    }

    private fun updateDraft(change: (WorkoutDraft) -> WorkoutDraft) {
        val logging = _state.value as? State.Logging ?: return
        val draft = change(logging.draft)
        _state.value = logging.copy(draft = draft, error = null)
        viewModelScope.launch { store.put(DRAFT_KEY, AppJson.encodeToString(draft)) }
    }

    private suspend fun restoreOrStart(today: WorkoutToday): WorkoutDraft {
        val saved = store.get(DRAFT_KEY)?.let { runCatching { AppJson.decodeFromString<WorkoutDraft>(it) }.getOrNull() }
        if (saved != null && saved.date == today.date) return saved
        return WorkoutDraft(
            date = today.date,
            startedAtMs = Clock.System.now().toEpochMilliseconds(),
            exercises = today.exercises.map { ex -> LoggedExercise(ex.name, ex.metric, ex.restSec ?: DEFAULT_REST, prefill(ex)) },
        )
    }

    companion object {
        const val DRAFT_KEY = "workout_draft"
        const val DEFAULT_REST = 90

        /** Rows prefilled from the progression target (weight x reps), falling back to the plan. */
        fun prefill(ex: WorkoutToday.Exercise): List<SetRow> {
            val weight = ex.target?.w ?: ex.weightKg
            val reps = ex.target?.r ?: ex.reps
            val row = SetRow(weight = weight?.let(::formatNumber) ?: "", reps = reps?.toString() ?: "")
            return List(ex.sets.coerceIn(1, 12)) { row }
        }

        /** Only finished sets go to the server; an exercise with none is left out. */
        fun toRequest(draft: WorkoutDraft, nowMs: Long = Clock.System.now().toEpochMilliseconds()): SaveWorkoutRequest? {
            val entries = draft.exercises.mapNotNull { ex ->
                val sets = ex.sets.filter { it.done }.map { row ->
                    SaveWorkoutRequest.SetDone(
                        reps = row.reps.toDoubleOrNull() ?: 0.0,
                        weight = row.weight.replace(',', '.').toDoubleOrNull() ?: 0.0,
                        seconds = row.seconds.toDoubleOrNull()?.takeIf { it > 0 },
                        meters = row.meters.toDoubleOrNull()?.takeIf { it > 0 },
                    )
                }
                if (sets.isEmpty()) null else SaveWorkoutRequest.Entry(ex.name, sets)
            }
            if (entries.isEmpty()) return null
            val duration = ((nowMs - draft.startedAtMs) / 1000).toInt()
            return SaveWorkoutRequest(entries = entries, durationSec = duration.takeIf { it in 1..18_000 })
        }

        fun formatNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
    }
}
