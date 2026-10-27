package app.hacklimits.shared.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.canFallbackToCache
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.DayWorkout
import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.TrainingPlanDay
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.data.Records
import app.hacklimits.shared.platform.PhotoPicker
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.registerLearnedMuscles
import app.hacklimits.shared.workout.PendingSaves
import kotlinx.coroutines.async
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
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
    private val cache: AccountCache,
    private val pending: PendingSaves,
) : ViewModel() {
    data class State(
        val loading: Boolean = true,
        val error: String? = null,
        val offline: Boolean = false,
        val lastUpdatedAtMs: Long? = null,
        val pendingSync: Int = 0,
        val needsAttention: Int = 0,
        val data: ProgressDashboard? = null,
        val records: Records = Records(),
        val planDays: List<TrainingPlanDay> = emptyList(),
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

    init {
        viewModelScope.launch {
            pending.observeCounts().collect { counts ->
                _state.update { it.copy(pendingSync = counts.pending, needsAttention = counts.needsAttention) }
            }
        }
    }

    fun photoUrl(id: Long): String = progress.photoUrl(id)

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(error = null) }
            val localDashboard = readCache("progress.dashboard.v1", ProgressDashboard.serializer())
            if (localDashboard != null) {
                val localRecords = readCache("progress.records.v1", Records.serializer()) ?: Records()
                val localPlan = readCache("progress.plan.v1", ListSerializer(TrainingPlanDay.serializer())).orEmpty()
                val localPhotos = readCache("progress.photos.v1", ListSerializer(PhotoRef.serializer())).orEmpty()
                val localBearer = api.bearer()
                _state.update {
                    it.copy(
                        loading = false,
                        offline = true,
                        lastUpdatedAtMs = cache.lastUpdatedAt("progress.dashboard.v1"),
                        data = localDashboard,
                        records = localRecords,
                        planDays = localPlan,
                        photos = localPhotos,
                        bearer = localBearer,
                        exercise = it.exercise ?: localDashboard.exercises.firstOrNull()?.name,
                        measureKey = it.measureKey ?: localDashboard.measurements.firstOrNull()?.key,
                    )
                }
            }
            try {
                coroutineScope {
                    val d = async { cached("progress.dashboard.v1", ProgressDashboard.serializer()) { progress.dashboard() } }
                    val r = async { cachedOrDefault("progress.records.v1", Records.serializer(), Records()) { progress.records() } }
                    val p = async { cachedOrDefault("progress.plan.v1", ListSerializer(TrainingPlanDay.serializer()), emptyList()) { progress.plan() } }
                    val ph = async { cachedOrDefault("progress.photos.v1", ListSerializer(PhotoRef.serializer()), emptyList()) { progress.photos() } }
                    val dashboardResult = d.await()
                    val data = dashboardResult.value
                    val queued = pending.count()
                    val attention = pending.needsAttentionCount()
                    val lastUpdatedAt = cache.lastUpdatedAt("progress.dashboard.v1")
                    registerLearnedMuscles(data.calendar.learnedMuscles)
                    _state.update {
                        it.copy(
                            loading = false,
                            offline = dashboardResult.fromCache,
                            lastUpdatedAtMs = lastUpdatedAt,
                            pendingSync = queued,
                            needsAttention = attention,
                            data = data,
                            records = r.await().value,
                            planDays = p.await().value,
                            photos = ph.await().value,
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

    private data class CachedValue<T>(val value: T, val fromCache: Boolean)

    private suspend fun <T> readCache(key: String, serializer: KSerializer<T>): T? = try {
        cache.read(key)?.let { AppJson.decodeFromString(serializer, it) }
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    private fun dayWorkoutCacheKey(date: String) = "progress.day.v1.$date"

    private suspend fun <T> cached(key: String, serializer: KSerializer<T>, fetch: suspend () -> T): CachedValue<T> {
        try {
            val value = fetch()
            cache.write(key, AppJson.encodeToString(serializer, value))
            return CachedValue(value, fromCache = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiException && !e.canFallbackToCache()) throw e
            val raw = cache.read(key) ?: throw e
            return CachedValue(AppJson.decodeFromString(serializer, raw), fromCache = true)
        }
    }

    private suspend fun <T> cachedOrDefault(key: String, serializer: KSerializer<T>, default: T, fetch: suspend () -> T): CachedValue<T> =
        try {
            cached(key, serializer, fetch)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            CachedValue(default, fromCache = false)
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
                cache.write(dayWorkoutCacheKey(date), AppJson.encodeToString(DayWorkout.serializer(), detail))
                _state.update { if (it.selectedDay == date) it.copy(dayDetail = detail) else it }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                val cached = readCache(dayWorkoutCacheKey(date), DayWorkout.serializer())
                _state.update {
                    if (it.selectedDay == date) it.copy(dayDetail = cached, dayDetailFailed = cached == null, offline = cached != null || it.offline) else it
                }
            } finally {
                _state.update { it.copy(dayDetailBusy = false) }
            }
        }
    }

    fun saveMeasure() {
        val text = _state.value.measureInput.trim()
        if (text.isEmpty()) return
        queueProgressChange(progress.measurePayload(text)) { it.copy(measureInput = "", notice = ProgressNotice.SAVED) }
    }

    fun saveCheckin() {
        val c = _state.value.checkin
        queueProgressChange(progress.checkinPayload(c.energy, c.sleep, c.stress)) { it.copy(notice = ProgressNotice.SAVED) }
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

    private fun queueProgressChange(payload: String, updateOnSave: (State) -> State) {
        if (_state.value.busy != null) return
        val key = Uuid.random().toString()
        viewModelScope.launch {
            _state.update { it.copy(busy = "sync", notice = null) }
            try {
                if (!pending.addOperation(PendingSaves.PROGRESS_KIND, key, payload)) {
                    throw IllegalStateException("Cannot safely queue without an account id")
                }
                _state.update(updateOnSave)
                val result = pending.syncPending()
                val queued = pending.count()
                val attention = pending.needsAttentionCount()
                _state.update { it.copy(offline = result.shouldRetry, pendingSync = queued, needsAttention = attention) }
                if (!result.shouldRetry) refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                _state.update { it.copy(notice = ProgressNotice.FAILED) }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }
}
