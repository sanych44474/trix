package app.hacklimits.shared.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.OnboardingApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.TimeZone

/**
 * The onboarding questionnaire (Mini App Onboarding.tsx): a welcome screen, then one question per
 * screen. Choice answers advance on tap; typed answers have a Next button. Answers are saved to the
 * server as a draft (debounced), so closing the app resumes at the first open question.
 *
 * The other way in is a ready program: the body basics (sex, age, height, weight), then the program
 * list; applying one onboards the person. [isClient] adds the trainer-sharing question.
 */
class OnboardingViewModel(private val api: OnboardingApi, val isClient: Boolean = false) : ViewModel() {
    enum class Mode { QUESTIONS, BASICS, PICK }

    enum class Failure { SAVE, VALIDATION, LOAD }

    data class State(
        val answers: Answers = Answers(),
        /** -1 is the welcome screen; otherwise the index into [steps]. */
        val index: Int = -1,
        val mode: Mode = Mode.QUESTIONS,
        val saving: Boolean = false,
        val failure: Failure? = null,
        val submitted: Boolean = false,
        /** A draft was found on the server; the welcome screen offers to resume it. */
        val hasDraft: Boolean = false,
        /** The question set from the server; null until it loads (a LOAD failure leaves it null). */
        val questions: List<Step>? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var draftJob: Job? = null
    private var advanceJob: Job? = null

    init {
        loadQuestions()
        viewModelScope.launch {
            val draft = api.loadDraft()
            if (draft != null && draft != Answers()) _state.update { it.copy(answers = draft, hasDraft = true) }
        }
    }

    /** Fetches the question set; a failure (or a question this app cannot show) sets [Failure.LOAD]. */
    fun loadQuestions() {
        viewModelScope.launch {
            val steps = try { stepsFrom(api.questions()) } catch (e: Exception) { null }
            _state.update { if (steps == null) it.copy(failure = Failure.LOAD) else it.copy(questions = steps, failure = null) }
        }
    }

    private val allSteps: List<Step> get() = _state.value.questions.orEmpty()

    fun stepsOf(s: State): List<Step> = if (s.mode == Mode.BASICS) basicSteps(s.questions.orEmpty()) else stepsFor(s.questions.orEmpty(), s.answers, isClient)

    fun answeredCount(s: State): Int = stepsOf(s).count { isAnswered(it, s.answers) }

    /** Welcome -> the first open question (a resumed draft continues where it stopped). */
    fun start() = _state.update { it.copy(index = firstOpenStep(it.questions.orEmpty(), it.answers, isClient), mode = Mode.QUESTIONS, failure = null) }

    /** Welcome -> the ready-program path: body basics first. */
    fun startReady() = _state.update { it.copy(mode = Mode.BASICS, index = 0, failure = null) }

    fun back() {
        val s = _state.value
        advanceJob?.cancel()
        when {
            s.mode == Mode.PICK -> _state.update { it.copy(mode = Mode.QUESTIONS, index = -1, failure = null) }
            s.mode == Mode.BASICS && s.index == 0 -> _state.update { it.copy(mode = Mode.QUESTIONS, index = -1, failure = null) }
            else -> _state.update { it.copy(index = it.index - 1, failure = null) }
        }
    }

    private fun edit(change: (Answers) -> Answers) {
        _state.update { it.copy(answers = change(it.answers), failure = null) }
        scheduleDraft()
    }

    /** Typed answers: the age, height or weight field. */
    fun setNumber(id: StepId, raw: String) {
        val value = raw.replace(',', '.').toDoubleOrNull()
        edit {
            when (id) {
                StepId.AGE -> it.copy(age = value?.toInt())
                StepId.HEIGHT -> it.copy(heightCm = value?.toInt())
                else -> it.copy(weightKg = value)
            }
        }
    }

    fun setLift(lift: String, raw: String) {
        val value = raw.toIntOrNull()
        edit { a ->
            val l = a.lifts ?: Lifts()
            a.copy(lifts = when (lift) {
                "bench" -> l.copy(bench = value)
                "squat" -> l.copy(squat = value)
                else -> l.copy(deadlift = value)
            })
        }
    }

    fun skipLifts() {
        edit { it.copy(lifts = null) }
        next()
    }

    fun toggleDay(day: Int) = edit { a ->
        val days = a.trainingWeekdays
        a.copy(trainingWeekdays = (if (day in days) days - day else days + day).sorted())
    }

    fun setLimitations(text: String) = edit { it.copy(limitations = text.take(500)) }

    /** "No limitations": answers the text step and moves on. */
    fun noLimitations() {
        edit { it.copy(limitations = "none") }
        next()
    }

    /** A choice tap: store it, then move on after a short beat so the tap visibly lands. */
    fun chooseOption(step: Step, value: String) {
        val next = choose(step, _state.value.answers, value)
        edit { next }
        advanceJob?.cancel()
        advanceJob = viewModelScope.launch {
            delay(180)
            val s = _state.value
            val steps = stepsOf(s.copy(answers = next))
            if (s.index >= steps.size - 1) finish(next) else _state.update { it.copy(index = it.index + 1) }
        }
    }

    /** Next on a typed step: only when the step's answer is valid. */
    fun next() {
        val s = _state.value
        val steps = stepsOf(s)
        val step = steps.getOrNull(s.index) ?: return
        if (!isAnswered(step, s.answers) || s.saving) return
        if (s.index >= steps.size - 1) finish(s.answers) else _state.update { it.copy(index = it.index + 1) }
    }

    private fun finish(final: Answers) {
        if (_state.value.mode == Mode.BASICS) saveBasics(final) else submit(final)
    }

    private fun saveBasics(final: Answers) {
        val body = basicsRequest(allSteps, final) ?: return
        viewModelScope.launch {
            _state.update { it.copy(saving = true, failure = null) }
            try {
                api.saveBasics(body)
                _state.update { it.copy(mode = Mode.PICK, index = -1) }
            } catch (e: Exception) {
                _state.update { it.copy(failure = Failure.SAVE) }
            } finally {
                _state.update { it.copy(saving = false) }
            }
        }
    }

    private fun submit(final: Answers) {
        val request = toRequest(allSteps, final, isClient, TimeZone.currentSystemDefault().id)
        if (request == null) {
            _state.update { it.copy(index = firstOpenStep(allSteps, final, isClient)) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(saving = true, failure = null) }
            try {
                api.submit(request)
                _state.update { it.copy(submitted = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(failure = if (e.code == "validation_error") Failure.VALIDATION else Failure.SAVE) }
            } catch (e: Exception) {
                _state.update { it.copy(failure = Failure.SAVE) }
            } finally {
                _state.update { it.copy(saving = false) }
            }
        }
    }

    /** The server keeps a copy (another device resumes it); debounced, best-effort. */
    private fun scheduleDraft() {
        val s = _state.value
        if (s.mode != Mode.QUESTIONS || s.index < 0) return
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(800)
            val current = _state.value
            runCatching { api.saveDraft(current.answers, answeredCount(current), stepsFor(allSteps, current.answers, isClient).size) }
        }
    }
}
