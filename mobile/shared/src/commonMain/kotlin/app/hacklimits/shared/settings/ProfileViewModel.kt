package app.hacklimits.shared.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.account.TrainerApi
import app.hacklimits.shared.account.TrainerProfile
import app.hacklimits.shared.account.WhatsNewApi
import app.hacklimits.shared.account.WhatsNewNote
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The profile card of More: personal details, weekly rhythm and consent (ProfileView.tsx), the invite
 * link, the trainer application (BecomeTrainer.tsx), the display preferences and What's new. */
class ProfileViewModel(
    private val profile: ProfileApi,
    private val trainers: TrainerApi,
    private val whatsNew: WhatsNewApi,
    private val display: DisplayPreferences,
) : ViewModel() {
    data class Form(
        val name: String = "",
        val goal: String = "",
        val level: String = "",
        val goalWeight: String = "",
        val waterGoalMl: String = "",
        val stepsGoal: String = "",
        val trainingWeekdays: List<Int> = emptyList(),
        /** Null unless the caller is a client: only clients decide what their trainer sees. */
        val share: ProfileResponse.Consent? = null,
    )

    data class TrainerForm(
        val name: String = "",
        val specialization: String = "",
        val city: String = "",
        val contact: String = "",
        val bio: String = "",
    )

    data class State(
        val loading: Boolean = true,
        val loadError: Boolean = false,
        val form: Form? = null,
        val options: ProfileResponse.ProfileOptions = ProfileResponse.ProfileOptions(),
        val weekdays: List<ProfileResponse.WeekdayOption> = emptyList(),
        val referralLink: String = "",
        val referredCount: Int = 0,
        val saving: Boolean = false,
        val saveError: Boolean = false,
        val saved: Boolean = false,
        val role: String = "solo",
        val trainer: TrainerProfile? = null,
        val trainerForm: TrainerForm = TrainerForm(),
        val trainerBusy: Boolean = false,
        val trainerSent: Boolean = false,
        val trainerError: Boolean = false,
        val whatsNew: WhatsNewNote? = null,
        val prefs: DisplayPrefs = DisplayPrefs(),
        val reminderHour: Int? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    init {
        viewModelScope.launch { display.load() }
        viewModelScope.launch { display.prefs.collect { p -> _state.update { it.copy(prefs = p) } } }
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, loadError = false) }
            val response = runCatching { profile.load() }.getOrNull()
            if (response == null) {
                _state.update { it.copy(loading = false, loadError = true) }
                return@launch
            }
            val p = response.profile
            _state.update {
                it.copy(
                    loading = false,
                    form = Form(
                        name = p.name,
                        goal = p.goal,
                        level = p.level,
                        goalWeight = p.goalWeight?.toString().orEmpty(),
                        waterGoalMl = p.waterGoalMl?.toString().orEmpty(),
                        stepsGoal = p.stepsGoal?.toString().orEmpty(),
                        trainingWeekdays = p.trainingWeekdays,
                        share = p.share,
                    ),
                    options = response.options,
                    weekdays = response.weekdays,
                    referralLink = response.referralLink,
                    reminderHour = response.profile.reminderHour,
                    referredCount = response.referredCount,
                )
            }
            loadTrainer()
            val note = runCatching { whatsNew.latest() }.getOrNull()
            _state.update { it.copy(whatsNew = note) }
        }
    }

    private suspend fun loadTrainer() {
        val response = runCatching { trainers.trainerProfile() }.getOrNull() ?: return
        _state.update { current ->
            val t = response.trainer
            current.copy(
                role = response.role,
                trainer = t,
                trainerForm = if (t == null) current.trainerForm else TrainerForm(t.name, t.specialization, t.city, t.contact, t.bio),
            )
        }
    }

    fun onName(value: String) = editForm { it.copy(name = value.take(60)) }
    fun onGoal(value: String) = editForm { it.copy(goal = value) }
    fun onLevel(value: String) = editForm { it.copy(level = value) }
    fun onGoalWeight(value: String) = editForm { it.copy(goalWeight = value) }
    fun onWaterGoal(value: String) = editForm { it.copy(waterGoalMl = value) }
    fun onStepsGoal(value: String) = editForm { it.copy(stepsGoal = value) }
    fun onShareBody(on: Boolean) = editForm { f -> f.copy(share = (f.share ?: ProfileResponse.Consent()).copy(body = on)) }
    fun onShareHealth(on: Boolean) = editForm { f -> f.copy(share = (f.share ?: ProfileResponse.Consent()).copy(health = on)) }

    fun toggleWeekday(day: Int) = editForm { f ->
        val next = if (day in f.trainingWeekdays) f.trainingWeekdays - day else (f.trainingWeekdays + day).sorted()
        f.copy(trainingWeekdays = next)
    }

    fun saveProfile() {
        val form = _state.value.form ?: return
        if (_state.value.saving) return
        val goalWeight = parseOptionalDouble(form.goalWeight)
        val water = parseOptionalInt(form.waterGoalMl)
        val steps = parseOptionalInt(form.stepsGoal)
        if (goalWeight.invalid || water.invalid || steps.invalid) {
            _state.update { it.copy(saveError = true, saved = false) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(saving = true, saveError = false, saved = false) }
            try {
                profile.save(
                    ProfileEdit(
                        name = form.name.trim(),
                        goal = form.goal,
                        level = form.level,
                        goalWeight = goalWeight.value,
                        waterGoalMl = water.value,
                        stepsGoal = steps.value,
                        trainingWeekdays = form.trainingWeekdays,
                        share = form.share,
                    ),
                )
                _state.update { it.copy(saved = true) }
            } catch (e: Exception) {
                _state.update { it.copy(saveError = true) }
            } finally {
                _state.update { it.copy(saving = false) }
            }
        }
    }

    fun onTrainerForm(transform: (TrainerForm) -> TrainerForm) = _state.update { it.copy(trainerForm = transform(it.trainerForm), trainerSent = false) }

    /** New application when there is no trainer row yet, otherwise an edit of the profile. */
    fun submitTrainer() {
        val form = _state.value.trainerForm
        if (form.name.isBlank() || _state.value.trainerBusy) return
        viewModelScope.launch {
            _state.update { it.copy(trainerBusy = true, trainerError = false, trainerSent = false) }
            try {
                trainers.saveTrainerProfile(form.name.trim(), form.specialization.trim(), form.city.trim(), form.contact.trim(), form.bio.trim())
                _state.update { it.copy(trainerSent = true) }
                loadTrainer()
            } catch (e: Exception) {
                _state.update { it.copy(trainerError = true) }
            } finally {
                _state.update { it.copy(trainerBusy = false) }
            }
        }
    }

    fun setThemeMode(mode: ThemeMode) = updatePrefs { it.copy(mode = mode) }
    fun setAccent(accent: Accent) = updatePrefs { it.copy(accent = accent) }
    fun setHighContrast(on: Boolean) = updatePrefs { it.copy(highContrast = on) }
    fun setReducedMotion(on: Boolean) = updatePrefs { it.copy(reducedMotion = on) }

    private fun editForm(transform: (Form) -> Form) = _state.update { current ->
        current.form?.let { current.copy(form = transform(it), saved = false, saveError = false) } ?: current
    }

    private fun updatePrefs(transform: (DisplayPrefs) -> DisplayPrefs) {
        viewModelScope.launch { display.update(transform(display.prefs.value)) }
    }

    private data class Parsed<T>(val value: T?, val invalid: Boolean)

    /** Blank clears the field; text that is not a number is an error, not a silent clear. */
    private fun parseOptionalDouble(text: String): Parsed<Double> {
        val t = text.trim()
        if (t.isEmpty()) return Parsed(null, false)
        val v = t.replace(',', '.').toDoubleOrNull()
        return Parsed(v, v == null)
    }

    private fun parseOptionalInt(text: String): Parsed<Int> {
        val t = text.trim()
        if (t.isEmpty()) return Parsed(null, false)
        val v = t.toIntOrNull()
        return Parsed(v, v == null)
    }
}
