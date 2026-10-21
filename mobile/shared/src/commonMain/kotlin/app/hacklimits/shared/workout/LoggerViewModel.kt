package app.hacklimits.shared.workout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.ExerciseInfo
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.data.SaveWorkoutRequest
import app.hacklimits.shared.data.SaveWorkoutResult
import app.hacklimits.shared.data.SwapChoice
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.data.WorkoutToday
import app.hacklimits.shared.platform.RestAlarm
import app.hacklimits.shared.workout.logic.DEFAULT_REST_SEC
import app.hacklimits.shared.workout.logic.DENSITY_MIN_SESSION_SEC
import app.hacklimits.shared.workout.logic.DRAFT_KEY
import app.hacklimits.shared.workout.logic.ExerciseMuscleTable
import app.hacklimits.shared.workout.logic.LoggerDraft
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.LoggerSet
import app.hacklimits.shared.workout.logic.REST_OVERRUN_CAP_SEC
import app.hacklimits.shared.workout.logic.RestPrefs
import app.hacklimits.shared.workout.logic.SessionClock
import app.hacklimits.shared.workout.logic.SessionQuality
import app.hacklimits.shared.workout.logic.buildSaveEntries
import app.hacklimits.shared.telemetry.Telemetry
import app.hacklimits.shared.workout.logic.chooseStart
import app.hacklimits.shared.workout.logic.clampRest
import app.hacklimits.shared.workout.logic.copyToLoggerExercises
import app.hacklimits.shared.workout.logic.countFilledSets
import app.hacklimits.shared.workout.logic.density
import app.hacklimits.shared.workout.logic.emptyLoggerSet
import app.hacklimits.shared.workout.logic.hydrateSaved
import app.hacklimits.shared.workout.logic.isExerciseFilled
import app.hacklimits.shared.workout.logic.isSetFilled
import app.hacklimits.shared.workout.logic.isoWeekday
import app.hacklimits.shared.workout.logic.localDateOf
import app.hacklimits.shared.workout.logic.parseDraft
import app.hacklimits.shared.workout.logic.parseRestPrefs
import app.hacklimits.shared.workout.logic.plannedSetsFor
import app.hacklimits.shared.workout.logic.prefillFromLast
import app.hacklimits.shared.workout.logic.removeLoggerSet
import app.hacklimits.shared.workout.logic.restMetricKey
import app.hacklimits.shared.workout.logic.restProgress
import app.hacklimits.shared.workout.logic.scoreRest
import app.hacklimits.shared.workout.logic.sessionElapsedSec
import app.hacklimits.shared.workout.logic.swapExercise
import app.hacklimits.shared.workout.logic.StartSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

private const val TODAY_CACHE_KEY = "workout_today_cache"
private const val REST_PREFS_KEY = "workout_rest_prefs"
private const val REST_BY_EXERCISE_KEY = "workout_rest_by_exercise"
private const val REST_CHOSEN_KEY = "workout_rest_chosen"
private const val DRAFT_PUSH_DELAY_MS = 2_500L
private const val MAX_PLATES_KG = 600.0

/**
 * The guided workout logger (Mini App parity: TrainView + useSession + logic/logger.ts). Holds the
 * session in one [LoggerUi] state, keeps the draft on the device and on the server, times the rest and
 * the session, and saves through [WorkoutApi] or the offline queue [PendingSaves].
 */
@OptIn(ExperimentalTime::class, ExperimentalUuidApi::class)
class LoggerViewModel(
    private val api: WorkoutApi,
    private val store: KeyValueStore,
    private val pending: PendingSaves,
    private val restAlarm: RestAlarm,
    private val telemetry: Telemetry,
) : ViewModel() {

    private val _ui = MutableStateFlow(LoggerUi())
    val ui: StateFlow<LoggerUi> = _ui.asStateFlow()

    /** The server's view of today (plan names for the swap check, the save state). */
    private var server: WorkoutToday? = null
    private var restStartedAtMs: Long? = null
    private var restTarget = DEFAULT_REST_SEC
    private var restJob: Job? = null
    private var draftJob: Job? = null
    private var pendingDraft: Pair<String, String>? = null
    private var restOwner: String? = null
    private var restAlarmTitle = ""
    private var restAlarmBody = ""

    init {
        viewModelScope.launch {
            val overrides = runCatching {
                AppJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), store.get(REST_BY_EXERCISE_KEY) ?: "{}")
            }.getOrDefault(emptyMap()).filterValues { it > 0 }
            val chosen = runCatching {
                AppJson.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), store.get(REST_CHOSEN_KEY) ?: "{}")
            }.getOrDefault(emptyMap()).filterValues { it > 0 }
            _ui.value = _ui.value.copy(restPrefs = parseRestPrefs(store.get(REST_PREFS_KEY)), restOverrides = overrides, restChosen = chosen)
        }
        load()
    }

    private fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

    /** Every state change goes through here, so the draft is kept wherever the person goes. */
    private fun edit(change: (LoggerUi) -> LoggerUi) {
        val next = change(_ui.value)
        _ui.value = next
        persistDraft(next)
    }

    // ---- loading ----

    /** Opens today's logger, or the cached plan when there is no signal in the gym. */
    fun load(quiet: Boolean = false) {
        viewModelScope.launch {
            runCatching { pending.flush() }
            if (!quiet) edit { it.copy(loading = true, error = null) }
            val raw = try {
                api.today().also { store.put(TODAY_CACHE_KEY, AppJson.encodeToString(WorkoutToday.serializer(), it)) }
            } catch (e: ApiException) {
                edit { it.copy(loading = false, error = e.code) }
                return@launch
            } catch (e: Exception) {
                val cached = cachedToday()
                if (cached == null) {
                    edit { it.copy(loading = false, error = "network") }
                    return@launch
                }
                cached
            }
            applyToday(raw)
        }
    }

    private suspend fun applyToday(raw: WorkoutToday) {
        server = raw
        val start = chooseStart(raw, readLocalDraft())
        edit { s ->
            s.copy(
                loading = false, error = null,
                date = raw.date,
                title = raw.title ?: raw.muscleGroup ?: "",
                exercises = start.exercises,
                logDate = start.logDate,
                copiedFrom = start.copiedFrom,
                saved = start.saved,
                drafted = start.drafted,
                savedAtMs = start.savedAt,
                editedAtMs = start.editedAt,
                restoredFromServer = start.source == StartSource.SERVER_DRAFT,
                sync = if (start.source == StartSource.SERVER_DRAFT) SyncState.SYNCED else SyncState.IDLE,
                clock = start.clock,
                dayLogged = raw.savedAt != null || !raw.saved.isNullOrEmpty(),
                actionError = null,
            )
        }
    }

    private suspend fun cachedToday(): WorkoutToday? = runCatching {
        store.get(TODAY_CACHE_KEY)?.let { AppJson.decodeFromString(WorkoutToday.serializer(), it) }
    }.getOrNull()?.takeIf { it.date == localDateOf(nowMs()) }

    /** Back from the background with nothing typed: today's workout again, so a plan change shows up. */
    fun onResume() {
        val s = _ui.value
        if (!s.drafted && !s.saved && !s.focus && s.tab == LoggerTab.TODAY && s.date.isNotEmpty()) load(quiet = true)
    }

    // ---- draft ----

    private suspend fun readLocalDraft(): LoggerDraft? = parseDraft(store.get(DRAFT_KEY))

    private fun persistDraft(s: LoggerUi) {
        if (s.loading || s.error != null || s.date.isEmpty()) return
        val draft = LoggerDraft(
            date = s.date, exercises = s.exercises, logDate = s.logDate, copiedFrom = s.copiedFrom,
            editedAt = s.editedAtMs, savedAt = s.savedAtMs, clock = s.clock,
        )
        val body = AppJson.encodeToString(LoggerDraft.serializer(), draft)
        viewModelScope.launch { store.put(DRAFT_KEY, body) }
        draftJob?.cancel()
        // Only today's unsaved work goes to the server; a back-filled past day stays on the device.
        if (!s.drafted || s.logDate != null) {
            pendingDraft = null
            return
        }
        pendingDraft = s.date to body
        if (s.sync != SyncState.PENDING) _ui.value = _ui.value.copy(sync = SyncState.PENDING)
        draftJob = viewModelScope.launch {
            delay(DRAFT_PUSH_DELAY_MS)
            pushDraft()
        }
    }

    private suspend fun pushDraft() {
        val (date, body) = pendingDraft ?: return
        pendingDraft = null
        val synced = runCatching { api.putDraft(date, body) }.isSuccess
        _ui.value = _ui.value.copy(sync = if (synced) SyncState.SYNCED else SyncState.OFFLINE)
    }

    // ---- editing the session ----

    private fun mutate(change: (List<LoggerExercise>) -> List<LoggerExercise>) = edit { s ->
        s.copy(exercises = change(s.exercises), editedAtMs = nowMs(), saved = false, drafted = true, summary = null, queued = false)
    }

    private fun mapExercise(index: Int, change: (LoggerExercise) -> LoggerExercise) =
        mutate { list -> list.map { if (it.index == index) change(it) else it } }

    /** The exercise's sets as they are shown: a finished set's numbers, else the row's suggestion. */
    fun writeSet(index: Int, setIndex: Int, set: LoggerSet) {
        markActive()
        mapExercise(index) { ex ->
            val sets = ex.done.toMutableList()
            while (sets.size <= setIndex) sets += emptyLoggerSet(ex.metric)
            sets[setIndex] = set
            ex.copy(setsDone = sets)
        }
    }

    fun fillPlanned(index: Int) {
        val backfill = _ui.value.logDate != null
        mapExercise(index) { ex -> if (backfill) ex.copy(setsDone = plannedSetsFor(ex)) else ex.copy(prefill = null) }
    }

    fun fillPlannedAll() = mutate { list -> list.map { it.copy(setsDone = plannedSetsFor(it)) } }

    fun fillLast(index: Int) {
        val backfill = _ui.value.logDate != null
        mapExercise(index) { ex ->
            val last = ex.last
            when {
                last.isNullOrEmpty() -> ex
                backfill -> ex.copy(setsDone = last.map { set ->
                    LoggerSet(weight = set.w, reps = set.r, seconds = set.sec.takeIf { it != 0.0 }, meters = set.m.takeIf { it != 0.0 })
                })
                else -> prefillFromLast(ex)
            }
        }
    }

    fun addSet(index: Int) = mapExercise(index) { ex -> ex.copy(setsDone = ex.done + emptyLoggerSet(ex.metric)) }

    fun removeSet(index: Int, setIndex: Int) = mapExercise(index) { ex -> removeLoggerSet(ex, setIndex) }

    fun moveExercise(index: Int, direction: Int) = mutate { list ->
        val at = list.indexOfFirst { it.index == index }
        val to = at + direction
        if (at < 0 || to < 0 || to >= list.size) return@mutate list
        val next = list.toMutableList()
        next[at] = list[to]
        next[to] = list[at]
        next.mapIndexed { i, ex -> ex.copy(index = i) }
    }

    /** Asks first when the exercise has typed numbers in it. */
    fun removeExercise(index: Int) {
        val ex = _ui.value.exercises.firstOrNull { it.index == index } ?: return
        if (ex.done.any { it.reps != 0.0 || (it.seconds ?: 0.0) != 0.0 || (it.meters ?: 0.0) != 0.0 || it.weight != 0.0 }) {
            edit { it.copy(removeConfirm = index, menuOpen = false) }
            return
        }
        confirmRemove(index)
    }

    fun confirmRemove(index: Int) {
        mutate { list -> list.filter { it.index != index }.mapIndexed { i, ex -> ex.copy(index = i) } }
        edit { it.copy(removeConfirm = null, menuOpen = false) }
    }

    fun dismissRemove() = edit { it.copy(removeConfirm = null) }

    /** Replaces the whole list from somewhere else (history, a past day): unsaved by definition. */
    private fun replaceWith(exercises: List<LoggerExercise>, logDate: String?, copiedFrom: String?) = edit { s ->
        s.copy(
            exercises = exercises, logDate = logDate, copiedFrom = copiedFrom,
            editedAtMs = nowMs(), saved = false, drafted = true, savedAtMs = null, summary = null,
            restoredFromServer = false, tab = LoggerTab.TODAY,
        )
    }

    // ---- focus mode and menus ----

    fun openFocus(index: Int) {
        telemetry.track("app_focus_open")
        edit { it.copy(focus = true, focusIndex = index, menuOpen = false) }
    }

    fun closeFocus() = edit { it.copy(focus = false, menuOpen = false) }

    fun goToExercise(index: Int) = edit { it.copy(focusIndex = index, menuOpen = false) }

    fun toggleMenu() = edit { it.copy(menuOpen = !it.menuOpen) }

    fun closeMenu() = edit { it.copy(menuOpen = false) }

    fun toggleMuscles() = edit { it.copy(musclesOpen = !it.musclesOpen) }

    fun toggleRestPrefs(index: Int) = edit { it.copy(restPrefsFor = if (it.restPrefsFor == index) null else index) }

    fun setRowDraft(key: String, draft: RowDraft?) = edit { s ->
        s.copy(rowDrafts = if (draft == null) s.rowDrafts - key else s.rowDrafts + (key to draft))
    }

    fun setRestTexts(title: String, body: String) {
        restAlarmTitle = title
        restAlarmBody = body
    }

    fun setTab(tab: LoggerTab) {
        edit { it.copy(tab = tab) }
        if (tab == LoggerTab.HISTORY && _ui.value.history == null) loadHistory()
    }

    fun restSecFor(ex: LoggerExercise): Int = clampRest(
        _ui.value.restOverrides[ex.name]
            ?: _ui.value.restChosen[restMetricKey(ex.metric)]
            ?: ex.restSec
            ?: _ui.value.restPrefs.forMetric(ex.metric),
    )

    /** A rest picked on an exercise: applies to that exercise by name, and is remembered on the device. */
    fun pickRest(exerciseName: String, seconds: Int) {
        val overrides = _ui.value.restOverrides + (exerciseName to clampRest(seconds))
        edit { it.copy(restOverrides = overrides) }
        persistOverrides(overrides)
        rememberChosen(exerciseName, clampRest(seconds))
    }

    /** A hand-picked rest also becomes the start for exercises of the same kind without their own. */
    private fun rememberChosen(exerciseName: String, seconds: Int) {
        val metric = _ui.value.exercises.firstOrNull { it.name == exerciseName }?.metric
        val chosen = _ui.value.restChosen + (restMetricKey(metric) to seconds)
        edit { it.copy(restChosen = chosen) }
        viewModelScope.launch {
            store.put(REST_CHOSEN_KEY, AppJson.encodeToString(MapSerializer(String.serializer(), Int.serializer()), chosen))
        }
    }

    fun patchRestPrefs(auto: Boolean? = null, sound: Boolean? = null) {
        val prefs = _ui.value.restPrefs.copy(auto = auto ?: _ui.value.restPrefs.auto, sound = sound ?: _ui.value.restPrefs.sound)
        edit { it.copy(restPrefs = prefs) }
        viewModelScope.launch { store.put(REST_PREFS_KEY, AppJson.encodeToString(RestPrefs.serializer(), prefs)) }
    }

    private fun persistOverrides(overrides: Map<String, Int>) {
        viewModelScope.launch {
            store.put(REST_BY_EXERCISE_KEY, AppJson.encodeToString(MapSerializer(String.serializer(), Int.serializer()), overrides))
        }
    }

    // ---- session clock and rest timer ----

    /** Starts the session clock at the first logged set or rest; no-op once it runs. */
    private fun markActive() = edit { s -> if (s.clock == null) s.copy(clock = SessionClock(startedAt = nowMs())) else s }

    /** The rest that is open (armed until now, overrun included), scored against its target; consumed once. */
    private fun takeOpenRest(now: Long): (SessionQuality) -> SessionQuality {
        val startedAt = restStartedAtMs ?: return { it }
        restStartedAtMs = null
        val actual = max(0, ((now - startedAt) / 1000.0).roundToInt())
        val target = restTarget
        return { q -> scoreRest(q, actual, target) }
    }

    /** Arms a rest: scores the previous one, shows the countdown and schedules the local alarm. */
    fun startRest(seconds: Int, label: String, exerciseName: String? = null) {
        val bounded = clampRest(seconds)
        val target = bounded
        armRest(bounded, label, target, exerciseName)
    }

    private fun armRest(seconds: Int, label: String, target: Int, owner: String?) {
        val now = nowMs()
        val score = takeOpenRest(now)
        restOwner = owner ?: restOwner
        edit { s ->
            val clock = s.clock
            val next = when {
                clock?.endedAt != null -> clock
                else -> (clock ?: SessionClock(startedAt = now)).let { it.copy(quality = score(it.quality)) }
            }
            s.copy(clock = next, rest = RestUi(endAtMs = now + seconds * 1000L, left = seconds, over = 0, done = false, target = target, label = label))
        }
        restStartedAtMs = now
        restTarget = target
        // The local notification is the app's "rest is over". No server timer: that one is the Mini
        // App's and arrives as a Telegram bot message, which made the app send both.
        restAlarm.schedule(seconds, restAlarmTitle, restAlarmBody)
        startTicker(now + seconds * 1000L)
    }

    private fun startTicker(endAtMs: Long) {
        restJob?.cancel()
        restJob = viewModelScope.launch {
            while (true) {
                val tick = restProgress(endAtMs, nowMs())
                if (!tick.done) {
                    _ui.value = _ui.value.let { s -> if (s.rest.endAtMs == endAtMs) s.copy(rest = s.rest.copy(left = tick.left, over = 0)) else s }
                } else if (tick.over >= REST_OVERRUN_CAP_SEC) {
                    _ui.value = _ui.value.let { s -> if (s.rest.endAtMs == endAtMs) s.copy(rest = RestUi(target = s.rest.target)) else s }
                    break
                } else {
                    _ui.value = _ui.value.let { s ->
                        if (s.rest.endAtMs == endAtMs) s.copy(rest = s.rest.copy(left = 0, over = tick.over, done = true)) else s
                    }
                }
                delay(500)
            }
        }
    }

    /** "Next" on the rest bar: scores the rest as it ran and clears it. */
    fun stopRest() {
        val score = takeOpenRest(nowMs())
        edit { s ->
            val clock = s.clock
            if (clock != null && clock.endedAt == null) s.copy(clock = clock.copy(quality = score(clock.quality))) else s
        }
        clearRest()
    }

    private fun clearRest() {
        restJob?.cancel()
        restJob = null
        restAlarm.cancel()
        _ui.value = _ui.value.let { s -> s.copy(rest = RestUi(target = s.rest.target)) }
        viewModelScope.launch { runCatching { api.cancelRestTimer() } }
    }

    /** −15 / +15 on a running rest: moves the deadline, and the target with it, so a deliberate change isn't "missed". */
    fun adjustRest(delta: Int) {
        val rest = _ui.value.rest
        val endAt = rest.endAtMs ?: return
        val now = nowMs()
        val remaining = max(0, ((endAt - now) / 1000.0).roundToInt())
        val next = clampRest(remaining + delta)
        val elapsed = restStartedAtMs?.let { max(0, ((now - it) / 1000.0).roundToInt()) } ?: 0
        restTarget = elapsed + next
        val owner = restOwner
        edit { s ->
            val overrides = if (owner == null) s.restOverrides
            else s.restOverrides + (owner to clampRest((s.restOverrides[owner] ?: rest.target) + delta))
            s.copy(
                rest = rest.copy(endAtMs = now + next * 1000L, left = next, over = 0, done = false),
                restOverrides = overrides,
            )
        }
        if (owner != null) {
            persistOverrides(_ui.value.restOverrides)
            _ui.value.restOverrides[owner]?.let { rememberChosen(owner, it) }
        }
        restAlarm.schedule(next, restAlarmTitle, restAlarmBody)
        startTicker(now + next * 1000L)
    }

    private fun finalClock(clock: SessionClock?, now: Long): SessionClock? {
        if (clock == null) return null
        if (clock.endedAt != null) return clock
        val startedAt = restStartedAtMs
        val quality = if (startedAt == null) clock.quality
        else scoreRest(clock.quality, max(0, ((now - startedAt) / 1000.0).roundToInt()), restTarget)
        return clock.copy(quality = quality, endedAt = now)
    }

    // ---- saving ----

    /** The dock's button: finishing asks first; the other actions save straight away. */
    fun pressSave() {
        val s = _ui.value
        if (s.saving || s.exercises.none(::isExerciseFilled)) return
        when (s.dockAction) {
            DockAction.Saved -> Unit
            DockAction.Finish -> edit { it.copy(finishConfirm = true) }
            else -> save()
        }
    }

    fun confirmFinish() {
        edit { it.copy(finishConfirm = false) }
        save()
    }

    fun dismissFinish() = edit { it.copy(finishConfirm = false) }

    private fun save() {
        val s = _ui.value
        val action = s.dockAction
        val startedSave = nowMs()
        val final = if (action == DockAction.Finish) finalClock(s.clock, startedSave) else null
        val elapsed = sessionElapsedSec(final, startedSave)
        val targetDate = s.logDate
        val entries = buildSaveEntries(s.exercises).map { ex ->
            SaveWorkoutRequest.Entry(
                name = ex.name,
                sets = ex.done.map { set ->
                    SaveWorkoutRequest.SetDone(reps = set.reps, weight = set.weight, seconds = set.seconds, meters = set.meters, rpe = set.rpe)
                },
                rpe = ex.rpe,
                planName = ex.planName,
            )
        }
        val timing = if (final != null && elapsed > 0) {
            Pair(elapsed, min(final.quality.restTotalSec, elapsed))
        } else null
        val key = Uuid.random().toString()
        val request = SaveWorkoutRequest(
            entries = entries,
            date = targetDate,
            durationSec = timing?.first,
            restTotalSec = timing?.second,
        )
        edit { it.copy(saving = true, actionError = null, queued = false) }
        viewModelScope.launch {
            draftJob?.cancel()
            pendingDraft = null
            try {
                val result = api.save(request, key)
                val doneAt = nowMs()
                if (action == DockAction.Finish) restStartedAtMs = null
                if (action == DockAction.Finish && _ui.value.rest.endAtMs != null) clearRest()
                edit { current ->
                    current.copy(
                        saving = false, saved = true, drafted = false, savedAtMs = doneAt, sync = SyncState.IDLE,
                        restoredFromServer = false,
                        clock = if (action == DockAction.Finish) final else current.clock,
                        summary = if (action != DockAction.Update) summaryOf(s, result, final, elapsed, doneAt) else current.summary,
                        summaryDate = if (action != DockAction.Update) targetDate else current.summaryDate,
                        feel = null, feelState = FeelState.IDLE,
                    )
                }
                if (targetDate != null) {
                    store.remove(DRAFT_KEY)
                    load()
                }
            } catch (e: ApiException) {
                if (e.status >= 500 || e.status == 429) queueOffline(key, request, action, final)
                else _ui.value = _ui.value.copy(saving = false, actionError = e.code)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                queueOffline(key, request, action, final)
            }
        }
    }

    /** No signal: the save stays on the phone with its key and date, and goes out when the network is back. */
    private suspend fun queueOffline(key: String, request: SaveWorkoutRequest, action: DockAction, final: SessionClock?) {
        pending.add(PendingSaves.Pending(key, request))
        val now = nowMs()
        edit { s ->
            s.copy(
                saving = false, saved = true, drafted = false, savedAtMs = now, queued = true,
                clock = if (action == DockAction.Finish) final else s.clock,
                restoredFromServer = false,
            )
        }
        if (action == DockAction.Finish) restStartedAtMs = null
        if (_ui.value.rest.endAtMs != null) clearRest()
    }

    private fun summaryOf(s: LoggerUi, result: SaveWorkoutResult, final: SessionClock?, elapsed: Int, doneAt: Long): SaveSummary {
        val volume = s.exercises.filter { it.metric == "reps" }.sumOf { ex ->
            ex.done.filter(::isSetFilled).sumOf { (it.weight) * it.reps }
        }
        return SaveSummary(
            prExercises = result.prExercises,
            newBadges = result.newBadges,
            level = result.level,
            leveledUp = result.leveledUp,
            totalWorkouts = result.totalWorkouts,
            sets = countFilledSets(s.exercises),
            elapsedSec = elapsed,
            densityPct = if (final != null && elapsed >= DENSITY_MIN_SESSION_SEC) {
                density(final.startedAt, final.quality.restTotalSec, final.endedAt ?: doneAt)
            } else null,
            bestStreak = final?.quality?.bestStreak ?: 0,
            volumeKg = volume,
            plannedSets = s.exercises.sumOf { max(it.sets, it.done.size) },
        )
    }

    fun sendFeel(value: String) {
        telemetry.track("app_feel_$value")
        val s = _ui.value
        val date = s.summaryDate ?: s.date
        edit { it.copy(feel = value, feelState = FeelState.BUSY) }
        viewModelScope.launch {
            val ok = runCatching { api.feel(date, value) }.isSuccess
            edit { it.copy(feelState = if (ok) FeelState.DONE else FeelState.FAILED) }
        }
    }

    /** Leaves the summary screen. */
    fun doneWithSummary() = edit { it.copy(summary = null, focus = false, menuOpen = false) }

    fun dismissActionError() = edit { it.copy(actionError = null) }

    fun dismissPlanNotice() = edit { it.copy(planNoticeName = null) }

    // ---- history ----

    fun loadHistory() {
        edit { it.copy(historyError = null) }
        viewModelScope.launch {
            try {
                val logs = api.history()
                edit { it.copy(history = logs) }
            } catch (e: ApiException) {
                edit { it.copy(historyError = e.code) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(historyError = "network") }
            }
        }
    }

    private fun withHistoryBusy(key: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            edit { it.copy(historyBusy = key) }
            try {
                block()
            } catch (e: ApiException) {
                edit { it.copy(historyError = e.code) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(historyError = "network") }
            } finally {
                edit { it.copy(historyBusy = null) }
            }
        }
    }

    /** "Repeat": the exercises and sets of a past day, copied into today's logger. */
    fun repeatDay(date: String) = withHistoryBusy("repeat:$date") {
        replaceWith(copyToLoggerExercises(api.past(date)), null, date)
    }

    /** "Edit this saved day": that day's sets, saved back onto the same date. */
    fun editSavedDay(date: String) = fillFromPast(targetDate = date, sourceDate = date)

    /** Log a missed day from another day's exercises. */
    fun fillFromPast(targetDate: String, sourceDate: String) = withHistoryBusy("fill:$sourceDate") {
        val exercises = copyToLoggerExercises(api.past(sourceDate))
        replaceWith(exercises, targetDate, sourceDate)
    }

    /** Log a missed day from scratch: the plan for that weekday. */
    fun startBlankDay(date: String) = withHistoryBusy("blank:$date") {
        val data = api.today(date)
        replaceWith(hydrateSaved(data), date, null)
    }

    fun setMissedDate(date: String) = edit { it.copy(missedDate = date) }

    /** Discards a repeat of a past session (and its server copy) and reloads today. */
    fun backToToday() {
        val s = _ui.value
        viewModelScope.launch {
            if (s.copiedFrom != null && s.logDate == null) runCatching { api.deleteDraft(s.date) }
            pendingDraft = null
            store.remove(DRAFT_KEY)
            restStartedAtMs = null
            edit { it.copy(summary = null, clock = null, copiedFrom = null) }
            load()
        }
    }

    // ---- swap, custom exercises, technique ----

    private fun planNameOf(ex: LoggerExercise): String = ex.planName ?: ex.name

    fun openSwap(index: Int) {
        val ex = _ui.value.exercises.firstOrNull { it.index == index } ?: return
        edit { it.copy(swapFor = index, busy = "swap:$index") }
        viewModelScope.launch {
            try {
                val data = api.swap(index, planNameOf(ex))
                edit { it.copy(swapChoices = data.alternatives) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(actionError = (e as? ApiException)?.code ?: "network") }
            } finally {
                edit { it.copy(busy = null) }
            }
        }
    }

    /** A typed muscle ("трицепс") lists exercises for it; anything else is the person's own exercise. */
    fun searchSwap(index: Int, text: String) {
        val q = text.trim()
        val ex = _ui.value.exercises.firstOrNull { it.index == index } ?: return
        if (q.length < 2) return
        edit { it.copy(busy = "swap:$index") }
        viewModelScope.launch {
            try {
                val data = api.swap(index, planNameOf(ex), muscle = q)
                if (data.muscle != null) {
                    edit { it.copy(swapChoices = data.alternatives) }
                    return@launch
                }
                val own = api.addCustom(q, Uuid.random().toString())
                own.muscles?.let { ExerciseMuscleTable.learn(own.name, it.primary, it.secondary) }
                applySwap(SwapChoice(name = own.name), own.videoUrl, own.videoTitle)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(actionError = (e as? ApiException)?.code ?: "network") }
            } finally {
                edit { it.copy(busy = null) }
            }
        }
    }

    fun pickSwap(choice: SwapChoice) = applySwap(choice)

    private fun applySwap(choice: SwapChoice, videoUrl: String? = null, videoTitle: String? = null) {
        val s = _ui.value
        val index = s.swapFor ?: return
        val current = s.exercises.firstOrNull { it.index == index }
        val planName = current?.let(::planNameOf)
        mutate { swapExercise(it, index, choice.name, videoUrl, videoTitle) }
        edit { it.copy(swapFor = null, swapChoices = emptyList()) }
        // Only an exercise that is in the saved plan can be rewritten there, and that asks first.
        val inPlan = planName != null && server?.exercises?.any { it.name == planName } == true
        if (!inPlan || planName == choice.name) return
        edit { it.copy(planSwapConfirm = PlanSwapConfirm(planName!!, choice)) }
    }

    fun confirmPlanSwap() {
        val confirm = _ui.value.planSwapConfirm ?: return
        edit { it.copy(planSwapConfirm = null) }
        viewModelScope.launch {
            val s = _ui.value
            try {
                api.swapInPlan(
                    weekday = isoWeekday(s.logDate ?: s.date),
                    expectName = confirm.planName,
                    value = confirm.choice.name,
                    catalogId = confirm.choice.id.takeIf { it.isNotEmpty() },
                )
                edit { it.copy(planNoticeName = confirm.choice.name) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(actionError = (e as? ApiException)?.code ?: "network") }
            }
        }
    }

    fun dismissPlanSwap() = edit { it.copy(planSwapConfirm = null) }

    fun closeSwap() = edit { it.copy(swapFor = null, swapChoices = emptyList()) }

    fun setCustomOpen(open: Boolean) = edit { it.copy(customOpen = open) }

    fun setCustomName(name: String) = edit { it.copy(customName = name) }

    fun addCustom() {
        val name = _ui.value.customName.trim()
        if (name.length < 2) return
        edit { it.copy(busy = "custom") }
        viewModelScope.launch {
            try {
                val result = api.addCustom(name, Uuid.random().toString())
                result.muscles?.let { ExerciseMuscleTable.learn(result.name, it.primary, it.secondary) }
                mutate { list ->
                    list + LoggerExercise(
                        index = list.size,
                        name = result.name,
                        metric = "reps",
                        sets = 1,
                        videoUrl = result.videoUrl,
                        videoTitle = result.videoTitle,
                    )
                }
                edit { it.copy(customName = "", customOpen = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                edit { it.copy(actionError = (e as? ApiException)?.code ?: "network") }
            } finally {
                edit { it.copy(busy = null) }
            }
        }
    }

    /** The info panel: the plan's own technique and video when it has them, else looked up by name. */
    fun openInfo(exercise: LoggerExercise) {
        val s = _ui.value
        if (s.infoFor == exercise.index) {
            edit { it.copy(infoFor = null, info = null) }
            return
        }
        if (!exercise.technique.isNullOrEmpty() || !exercise.videoUrl.isNullOrEmpty()) {
            edit {
                it.copy(
                    infoFor = exercise.index,
                    info = ExerciseInfo(technique = exercise.technique.orEmpty(), videoUrl = exercise.videoUrl, videoTitle = exercise.videoTitle),
                )
            }
            return
        }
        edit { it.copy(infoFor = exercise.index, info = null, busy = "info:${exercise.index}") }
        viewModelScope.launch {
            val info = runCatching { api.exerciseInfo(exercise.name) }.getOrNull()
            edit { it.copy(info = info, busy = null) }
        }
    }

    /** Technique steps for a free-exercise-db id, translated and cached by the server. */
    suspend fun techniqueSteps(id: String): List<String> = runCatching { api.steps(id).steps }.getOrDefault(emptyList())

    // ---- plates ----

    fun setPlatesText(text: String) = edit { it.copy(plates = it.plates.copy(kgText = text)) }

    fun calcPlates() {
        val kg = _ui.value.plates.kgText.replace(',', '.').toDoubleOrNull() ?: return
        if (kg <= 0 || kg > MAX_PLATES_KG) return
        edit { it.copy(plates = it.plates.copy(busy = true)) }
        viewModelScope.launch {
            val result = runCatching { api.plates(kg) }.getOrNull()
            edit { it.copy(plates = PlatesUi(kgText = it.plates.kgText, result = result, busy = false, failed = result == null)) }
        }
    }
}
