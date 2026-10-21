package app.hacklimits.shared.workout.logic

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.WorkoutCopyExercise
import app.hacklimits.shared.data.WorkoutToday
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToLong

// The guided logger's state rules (port of apps/mini-app/src/logic/logger.ts and logic/hydrate.ts).
// The JSON field names match the Mini App's draft, because the server keeps the draft as one opaque
// body that either client may read back.

const val DRAFT_KEY = "workout_draft_v2"
/** A measured session longer than this is a stale clock. */
const val MAX_SESSION_SEC = 5 * 3600
/** Below this, "% of time working" is noise. */
const val DENSITY_MIN_SESSION_SEC = 10 * 60
/** Device and server clocks disagree a little; a server save this much newer is a real edit. */
private const val CLOCK_SKEW_MS = 2 * 60_000L

@Serializable
data class LoggerSet(
    val weight: Double = 0.0,
    val reps: Double = 0.0,
    val seconds: Double? = null,
    val meters: Double? = null,
    val rpe: Double? = null,
)

/** One exercise in the logger. [planName] is set when a plan exercise was swapped for this one. */
@Serializable
data class LoggerExercise(
    val index: Int,
    val name: String,
    val metric: String = "reps",
    val sets: Int = 1,
    val reps: Double? = null,
    val weightKg: Double? = null,
    val planSets: String? = null,
    val planWeight: String? = null,
    val technique: String? = null,
    val note: String? = null,
    val canonicalName: String? = null,
    val videoUrl: String? = null,
    val videoTitle: String? = null,
    val target: WorkoutToday.Target? = null,
    val last: List<WorkoutToday.PastSet>? = null,
    val restSec: Int? = null,
    val planName: String? = null,
    /** Numbers put into the rows by "Repeat last": suggestions, not done sets. */
    val prefill: List<LoggerSet>? = null,
    val setsDone: List<LoggerSet>? = null,
    val rpe: Double? = null,
) {
    val done: List<LoggerSet> get() = setsDone ?: emptyList()
}

/** The session clock: start, rest tally, and once finished, the end (so a later typo doesn't stretch it). */
@Serializable
data class SessionClock(
    val startedAt: Long,
    val quality: SessionQuality = SessionQuality(),
    val endedAt: Long? = null,
)

/** What is kept between visits, locally and (as the same JSON) on the server. */
@Serializable
data class LoggerDraft(
    val v: Int = 2,
    val date: String,
    val exercises: List<LoggerExercise>,
    val logDate: String? = null,
    val copiedFrom: String? = null,
    val editedAt: Long = 0,
    val savedAt: Long? = null,
    val clock: SessionClock? = null,
)

/** ISO weekday of a YYYY-MM-DD string: 1 = Monday .. 7 = Sunday. */
fun isoWeekday(date: String): Int = LocalDate.parse(date).dayOfWeek.ordinal + 1

fun isoDateMinus(date: String, days: Int): String = LocalDate.parse(date).plus(-days, DateTimeUnit.DAY).toString()

/** The device's calendar date for an epoch-ms instant. */
fun localDateOf(epochMs: Long): String =
    Instant.fromEpochMilliseconds(epochMs).toLocalDateTime(TimeZone.currentSystemDefault()).date.toString()

fun emptyLoggerSet(metric: String): LoggerSet = when (metric) {
    "time" -> LoggerSet(seconds = 0.0)
    "distance" -> LoggerSet(meters = 0.0)
    else -> LoggerSet()
}

fun isSetFilled(set: LoggerSet): Boolean = set.reps != 0.0 || (set.seconds ?: 0.0) != 0.0 || (set.meters ?: 0.0) != 0.0

fun isExerciseFilled(exercise: LoggerExercise): Boolean = exercise.done.any(::isSetFilled)

/** Drops one set. Removing a planned set also lowers the session's planned count; at least one set stays. */
fun removeLoggerSet(exercise: LoggerExercise, setIndex: Int): LoggerExercise {
    val planned = maxOf(1, exercise.sets)
    val done = exercise.done
    if (maxOf(planned, done.size) <= 1) return exercise
    return exercise.copy(
        setsDone = done.filterIndexed { i, _ -> i != setIndex },
        sets = if (setIndex < planned) maxOf(1, planned - 1) else exercise.sets,
    )
}

/** The sets a "did exactly what was planned" fill produces for one exercise. */
fun plannedSetsFor(exercise: LoggerExercise): List<LoggerSet> = List(maxOf(1, exercise.sets)) {
    when (exercise.metric) {
        "reps" -> LoggerSet(weight = exercise.weightKg ?: 0.0, reps = exercise.reps ?: 0.0)
        "time" -> LoggerSet(seconds = exercise.reps ?: 0.0)
        else -> LoggerSet(meters = exercise.reps ?: 0.0)
    }
}

/** What a row should hold before it is logged: "Repeat last" numbers, else today's progression target, else the plan. */
fun suggestionFor(exercise: LoggerExercise, setIndex: Int): LoggerSet {
    val repeated = exercise.prefill
    if (!repeated.isNullOrEmpty()) return repeated[min(setIndex, repeated.size - 1)]
    val planned = plannedSetsFor(exercise)
    val base = planned[min(setIndex, planned.size - 1)]
    val target = exercise.target
    return if (exercise.metric == "reps" && target != null) base.copy(weight = target.w, reps = target.r.toDouble()) else base
}

/** The last session's sets as suggestions: nothing is marked done, the rows grow to last session's count. */
fun prefillFromLast(exercise: LoggerExercise): LoggerExercise {
    val last = exercise.last
    if (last.isNullOrEmpty()) return exercise
    val prefill = last.map { set ->
        LoggerSet(weight = set.w, reps = set.r, seconds = set.sec.takeIf { it != 0.0 }, meters = set.m.takeIf { it != 0.0 })
    }
    return exercise.copy(prefill = prefill, sets = maxOf(exercise.sets, prefill.size))
}

fun copyToLoggerExercises(items: List<WorkoutCopyExercise>): List<LoggerExercise> = items.mapIndexed { index, item ->
    LoggerExercise(
        index = index,
        name = item.name,
        metric = item.metric,
        sets = maxOf(1, item.sets.size),
        setsDone = item.sets.map { set ->
            LoggerSet(
                weight = set.w, reps = set.r,
                seconds = set.sec.takeIf { it != 0.0 }, meters = set.m.takeIf { it != 0.0 },
                rpe = item.rpe.takeIf { it != 0.0 },
            )
        },
        rpe = item.rpe.takeIf { it != 0.0 },
    )
}

/** Swaps one exercise for another, remembering which plan exercise it stands in for. Swapping back
 * to the plan's own exercise clears that again. The plan's technique, video, target and weight
 * describe the old exercise, so they go. */
fun swapExercise(exercises: List<LoggerExercise>, index: Int, name: String, videoUrl: String? = null, videoTitle: String? = null): List<LoggerExercise> =
    exercises.map { exercise ->
        if (exercise.index != index) return@map exercise
        val planName = exercise.planName ?: exercise.name
        exercise.copy(
            name = name,
            metric = metricFromName(name),
            setsDone = emptyList(),
            planName = if (planName != name) planName else null,
            technique = null, note = null, canonicalName = null,
            videoUrl = videoUrl?.takeIf { it.isNotEmpty() }, videoTitle = videoTitle?.takeIf { it.isNotEmpty() },
            target = null, last = null, planWeight = null, weightKg = null, prefill = null,
        )
    }

/** Save entries: only exercises with at least one filled set. */
fun buildSaveEntries(exercises: List<LoggerExercise>): List<LoggerExercise> = exercises.filter(::isExerciseFilled)

fun countFilledSets(exercises: List<LoggerExercise>): Int = exercises.sumOf { exercise -> exercise.done.count(::isSetFilled) }

/** Session length in seconds, or 0 when there is no trustworthy clock. */
fun sessionElapsedSec(clock: SessionClock?, nowMs: Long): Int {
    if (clock == null) return 0
    val sec = (((clock.endedAt ?: nowMs) - clock.startedAt) / 1000.0).roundToLong().toInt()
    return if (sec in 1..MAX_SESSION_SEC) sec else 0
}

fun parseDraft(raw: String?): LoggerDraft? {
    if (raw.isNullOrBlank()) return null
    return runCatching { AppJson.decodeFromString<LoggerDraft>(raw) }.getOrNull()?.takeIf { it.date.isNotEmpty() }
}

fun isDraftSaved(draft: LoggerDraft): Boolean = draft.savedAt != null && draft.editedAt <= draft.savedAt

enum class StartSource { LOCAL, SERVER_DRAFT, SAVED, PLAN }

data class StartState(
    val source: StartSource,
    val exercises: List<LoggerExercise>,
    val logDate: String?,
    val copiedFrom: String?,
    val saved: Boolean,
    val drafted: Boolean,
    val clock: SessionClock?,
    val savedAt: Long?,
    val editedAt: Long,
)

/**
 * What the logger shows when it opens: the newest of this device's draft and the server's copy of an
 * unsaved draft, unless the saved log is newer (edited elsewhere), else the saved log, else the plan.
 */
fun chooseStart(server: WorkoutToday, local: LoggerDraft?, remote: LoggerDraft? = parseDraft(server.draft?.body)): StartState {
    val serverSavedAt = server.savedAt?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }
    val planNames = server.exercises.map { it.name }
    // A draft with nothing logged is only the plan as it looked when the logger last opened. Once the
    // plan has an exercise the draft lacks, the plan wins.
    fun outdated(d: LoggerDraft): Boolean {
        if (d.exercises.any { e -> e.done.any(::isSetFilled) }) return false
        val names = d.exercises.map { it.planName ?: it.name }.toSet()
        return planNames.any { it !in names }
    }
    val candidates = buildList {
        if (local != null && local.date == server.date && !outdated(local)) add(local to StartSource.LOCAL)
        if (remote != null && remote.date == server.date && !outdated(remote)) add(remote to StartSource.SERVER_DRAFT)
    }
    val newest = candidates.maxByOrNull { it.first.editedAt }

    fun fromSaved(clock: SessionClock?) = StartState(
        source = StartSource.SAVED,
        exercises = hydrateSaved(server),
        logDate = null, copiedFrom = null, saved = true, drafted = false,
        clock = clock,
        savedAt = serverSavedAt,
        editedAt = serverSavedAt ?: 0L,
    )

    if (newest != null) {
        val (draft, source) = newest
        val savedElsewhere = !server.saved.isNullOrEmpty() && serverSavedAt != null && serverSavedAt > draft.editedAt + CLOCK_SKEW_MS
        if (!savedElsewhere) {
            val saved = isDraftSaved(draft)
            return StartState(
                source = source,
                exercises = draft.exercises,
                logDate = draft.logDate,
                copiedFrom = draft.copiedFrom,
                saved = saved,
                drafted = !saved,
                clock = draft.clock,
                savedAt = draft.savedAt,
                editedAt = draft.editedAt,
            )
        }
        if (!server.saved.isNullOrEmpty()) return fromSaved(draft.clock)
    }
    if (!server.saved.isNullOrEmpty()) return fromSaved(null)
    return StartState(StartSource.PLAN, server.exercises.map(::fromPlan), null, null, saved = false, drafted = false, clock = null, savedAt = null, editedAt = 0)
}

/** Plan exercise as a logger row (the server's shape has the same names, plus the plan's own sets). */
fun fromPlan(ex: WorkoutToday.Exercise): LoggerExercise = LoggerExercise(
    index = ex.index, name = ex.name, metric = ex.metric, sets = ex.sets, reps = ex.reps, weightKg = ex.weightKg,
    planSets = ex.planSets, planWeight = ex.planWeight, technique = ex.technique, note = ex.note,
    canonicalName = ex.canonicalName, videoUrl = ex.videoUrl, videoTitle = ex.videoTitle,
    target = ex.target, last = ex.last, restSec = ex.restSec,
)

/**
 * Rebuilds the logger from what the server already has saved for this date: every saved entry, in the
 * order it was logged, merged with its plan exercise when the names match; the plan exercises not
 * logged yet follow, except the ones that were swapped out.
 */
fun hydrateSaved(data: WorkoutToday): List<LoggerExercise> {
    val saved = data.saved
    if (saved.isNullOrEmpty()) return data.exercises.map(::fromPlan)
    val plan = data.exercises
    val used = mutableSetOf<Int>()
    fun claim(name: String): Int {
        val at = plan.indices.firstOrNull { it !in used && plan[it].name == name } ?: -1
        if (at >= 0) used += at
        return at
    }
    var guesses = 0
    val merged = saved.map { entry ->
        val setsDone = entry.sets.map { set ->
            LoggerSet(weight = set.w, reps = set.r, seconds = set.sec.takeIf { it != 0.0 }, meters = set.m.takeIf { it != 0.0 }, rpe = entry.rpe)
        }
        val at = claim(entry.name)
        if (at >= 0) return@map fromPlan(plan[at]).copy(setsDone = setsDone, rpe = entry.rpe)
        // A swap: keep the replaced slot's rest only; the name, metric and sets are what was done.
        val slot = entry.planName?.let(::claim) ?: -1
        if (entry.planName == null) guesses += 1
        LoggerExercise(
            index = 0,
            name = entry.name,
            metric = savedMetric(entry),
            sets = maxOf(1, setsDone.size),
            setsDone = setsDone,
            rpe = entry.rpe,
            restSec = if (slot >= 0) plan[slot].restSec else null,
            planName = entry.planName,
        )
    }
    val remaining = plan.filterIndexed { i, _ ->
        if (i in used) return@filterIndexed false
        if (guesses > 0) { guesses -= 1; return@filterIndexed false }
        true
    }
    return (merged + remaining.map(::fromPlan)).mapIndexed { i, ex -> ex.copy(index = i) }
}

// Logs don't store the metric, so it is inferred from what was recorded.
private fun savedMetric(entry: WorkoutToday.SavedEntry): String = when {
    entry.sets.any { it.sec > 0 } -> "time"
    entry.sets.any { it.m > 0 } -> "distance"
    else -> "reps"
}

/** How a save used the engine's targets: per logged exercise with a target, "kept" when every filled set used the target weight. */
fun targetUse(exercises: List<LoggerExercise>): Pair<Int, Int> {
    var kept = 0
    var edited = 0
    for (e in exercises) {
        val target = e.target ?: continue
        val sets = e.done.filter(::isSetFilled)
        if (sets.isEmpty()) continue
        if (sets.all { abs(it.weight - target.w) < 0.01 }) kept++ else edited++
    }
    return kept to edited
}

/** Milliseconds from an ISO timestamp, or null when it does not parse. */
fun parseIsoMs(value: String?): Long? = value?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() }
