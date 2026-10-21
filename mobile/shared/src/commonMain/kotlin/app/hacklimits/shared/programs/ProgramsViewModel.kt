package app.hacklimits.shared.programs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.telemetry.Telemetry
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the screen says after an apply or take. */
sealed interface ProgramNote {
    data class Applied(val name: String) : ProgramNote
    data class Taken(val name: String) : ProgramNote
    /** A trainer manages this person's plan, so a ready program cannot replace it. */
    data object TrainerManaged : ProgramNote
    data object Error : ProgramNote
}

/** Ready programs (filter, open, apply) and the shared program library (take). */
class ProgramsViewModel(
    private val programs: ProgramsApi,
    private val shared: SharedProgramsApi,
    private val telemetry: Telemetry,
) : ViewModel() {
    data class State(
        val programs: List<ReadyProgram>? = null,
        val role: String = "",
        val failed: Boolean = false,
        val place: String = "gym",
        /** "any" or beginner | intermediate | advanced. */
        val level: String = "any",
        /** "any", "women" or "men". */
        val audience: String = "any",
        val open: String? = null,
        val showAll: Boolean = false,
        /** The program whose apply is waiting for confirmation. */
        val confirm: String? = null,
        val busy: Boolean = false,
        val note: ProgramNote? = null,
        val shared: List<SharedProgram>? = null,
        val sharedFailed: Boolean = false,
        val takingCode: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        load()
        loadShared()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(failed = false) }
            try {
                val r = programs.list()
                _state.update { it.copy(programs = r.programs, role = r.role) }
            } catch (e: Exception) {
                _state.update { it.copy(failed = true) }
            }
        }
    }

    fun loadShared() {
        viewModelScope.launch {
            _state.update { it.copy(sharedFailed = false) }
            try {
                val r = shared.list()
                _state.update { it.copy(shared = r.programs) }
            } catch (e: Exception) {
                _state.update { it.copy(sharedFailed = true) }
            }
        }
    }

    fun setPlace(place: String) = _state.update { it.copy(place = place, open = null, showAll = false) }
    fun setLevel(level: String) = _state.update { it.copy(level = level) }
    fun setAudience(audience: String) = _state.update { it.copy(audience = audience) }
    fun toggleOpen(id: String) = _state.update { it.copy(open = if (it.open == id) null else id, confirm = null) }
    fun showAll() = _state.update { it.copy(showAll = true) }
    fun askConfirm(id: String?) = _state.update { it.copy(confirm = id) }

    /** The programs the filters show, in the catalogue order. */
    fun visible(s: State): List<ReadyProgram> = s.programs.orEmpty().filter { p ->
        p.place == s.place &&
            (s.level == "any" || p.level == s.level) &&
            (s.audience == "any" || p.audience == s.audience || p.audience == "all")
    }

    /** Applies a ready program to the person; [onApplied] runs after the server accepted it. */
    fun apply(program: ReadyProgram, onApplied: () -> Unit = {}) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, note = null) }
            try {
                val r = programs.apply(program.id)
                telemetry.track("app_program_applied")
                _state.update { it.copy(note = ProgramNote.Applied(r.name.ifEmpty { program.name }), confirm = null) }
                onApplied()
            } catch (e: ApiException) {
                _state.update { it.copy(note = if (e.status == 403) ProgramNote.TrainerManaged else ProgramNote.Error) }
            } catch (e: Exception) {
                _state.update { it.copy(note = ProgramNote.Error) }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    /** Takes a shared program: it becomes the person's plan, adapted to them. */
    fun take(program: SharedProgram) {
        if (_state.value.takingCode != null) return
        viewModelScope.launch {
            _state.update { it.copy(takingCode = program.code, note = null) }
            try {
                shared.take(program.code)
                _state.update { it.copy(note = ProgramNote.Taken(program.name)) }
            } catch (e: Exception) {
                _state.update { it.copy(note = ProgramNote.Error) }
            } finally {
                _state.update { it.copy(takingCode = null) }
            }
        }
    }
}
