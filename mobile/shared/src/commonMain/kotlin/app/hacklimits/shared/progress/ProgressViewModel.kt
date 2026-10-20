package app.hacklimits.shared.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.DayWorkout
import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.PlanDay
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.data.Records
import app.hacklimits.shared.platform.PhotoPicker
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.registerLearnedMuscles
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** The Progress screen's three tabs. */
enum class ProgressSection { TRAIN, BODY, FOOD }

/** Outcome of the last save, shown under the form that made it. */
enum class ProgressNotice { SAVED, PHOTO_SAVED, FAILED }

data class Checkin(val energy: Int = 3, val sleep: Int = 3, val stress: Int = 3)

/**
 * Progress (Mini App ProgressView): the training, body and food tabs over one dashboard payload, the
 * personal records, the plan (for the body map's exercise picker), the progress photos, and the
 * body-measurement / check-in / photo forms.
 */
@OptIn(ExperimentalUuidApi::class)
class ProgressViewModel(
    private val progress: ProgressApi,
    // Injected by SharedModule; the Progress payload comes from ProgressApi.dashboard(), which carries the fields this screen needs.
    @Suppress("unused") private val dashboard: DashboardApi,
    private val api: ApiClient,
    private val picker: PhotoPicker,
) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val error: String? = null,
        val data: ProgressDashboard? = null,
        val records: Records = Records(),
        val planDays: List<PlanDay> = emptyList(),
        val photos: List<PhotoRef> = emptyList(),
        val bearer: String? = null,
        val section: ProgressSection = ProgressSection.TRAIN,
        val weightPeriod: Int = 30,
        val exercise: String? = null,
        val measureKey: String? = null,
        val selectedDay: String? = null,
        val dayDetail: DayWorkout? = null,
        val dayDetailBusy: Boolean = false,
        val dayDetailFailed: Boolean = false,
        val measureInput: String = "",
        val checkin: Checkin = Checkin(),
        val busy: String? = null,
        val notice: ProgressNotice? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun photoUrl(id: Long): String = progress.photoUrl(id)

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(error = null) }
            try {
                coroutineScope {
                    val d = async { progress.dashboard() }
                    val r = async { runCatching { progress.records() }.getOrDefault(Records()) }
                    val p = async { runCatching { progress.plan() }.getOrDefault(emptyList()) }
                    val ph = async { runCatching { progress.photos() }.getOrDefault(emptyList()) }
                    val data = d.await()
                    registerLearnedMuscles(data.calendar.learnedMuscles)
                    _state.update {
                        it.copy(
                            loading = false,
                            data = data,
                            records = r.await(),
                            planDays = p.await(),
                            photos = ph.await(),
                            bearer = api.bearer(),
                            exercise = it.exercise ?: data.exercises.firstOrNull()?.name,
                            measureKey = it.measureKey ?: data.measurements.firstOrNull()?.key,
                        )
                    }
                }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "network") }
            }
        }
    }

    fun selectSection(section: ProgressSection) = _state.update { it.copy(section = section) }

    fun selectWeightPeriod(days: Int) = _state.update { it.copy(weightPeriod = days) }

    fun selectExercise(name: String) = _state.update { it.copy(exercise = name) }

    fun selectMeasureKey(key: String) = _state.update { it.copy(measureKey = key) }

    fun onMeasureInput(text: String) = _state.update { it.copy(measureInput = text) }

    fun onCheckin(checkin: Checkin) = _state.update { it.copy(checkin = checkin) }

    /** Taps a day of the calendar: opens its detail, or closes it when it is already open. */
    fun openDay(date: String) {
        val current = _state.value
        if (current.selectedDay == date) {
            _state.update { it.copy(selectedDay = null) }
            return
        }
        val today = current.data?.today ?: return
        val floor = isoPlusDays(today, -14) // the workout-detail endpoint's 14-day window
        _state.update { it.copy(selectedDay = date, dayDetail = null, dayDetailFailed = false) }
        if (date < floor || date > today) return // outside the window: the calendar's own data only
        viewModelScope.launch {
            _state.update { it.copy(dayDetailBusy = true) }
            try {
                val detail = progress.dayWorkout(date)
                _state.update { if (it.selectedDay == date) it.copy(dayDetail = detail) else it }
            } catch (e: Exception) {
                _state.update { if (it.selectedDay == date) it.copy(dayDetailFailed = true) else it }
            } finally {
                _state.update { it.copy(dayDetailBusy = false) }
            }
        }
    }

    fun saveMeasure() {
        val text = _state.value.measureInput.trim()
        if (text.isEmpty()) return
        act("measure") {
            progress.logMeasure(text, Uuid.random().toString())
            _state.update { it.copy(measureInput = "", notice = ProgressNotice.SAVED) }
        }
    }

    fun saveCheckin() {
        val c = _state.value.checkin
        act("checkin") {
            progress.logCheckin(c.energy, c.sleep, c.stress, Uuid.random().toString())
            _state.update { it.copy(notice = ProgressNotice.SAVED) }
        }
    }

    fun addPhoto() = act("photo") {
        val photo = picker.pick() ?: return@act
        progress.uploadPhoto(photo.bytes, photo.mimeType)
        val photos = runCatching { progress.photos() }.getOrDefault(_state.value.photos)
        _state.update { it.copy(photos = photos, notice = ProgressNotice.PHOTO_SAVED) }
    }

    private fun act(key: String, block: suspend () -> Unit) {
        if (_state.value.busy != null) return
        viewModelScope.launch {
            _state.update { it.copy(busy = key, notice = null) }
            try {
                block()
            } catch (e: Exception) {
                _state.update { it.copy(notice = ProgressNotice.FAILED) }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }
}
