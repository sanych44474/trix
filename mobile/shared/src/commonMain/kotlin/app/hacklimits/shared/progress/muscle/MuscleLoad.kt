package app.hacklimits.shared.progress.muscle

import app.hacklimits.shared.muscles.ExerciseMuscles
import app.hacklimits.shared.muscles.classify
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.daysUntil
import kotlinx.datetime.plus
import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.min

// Per-muscle load from logged workouts: a set counts in full for an exercise's primary movers and as
// half a set for its helpers. Port of src/domain/muscleLoad.ts (the parts the Progress screen uses).

/** The muscles the Progress screen reports on. */
val TRACKED_MUSCLES: List<String> = listOf(
    "chest", "upper-back", "trapezius", "lower-back", "deltoids", "biceps", "triceps", "forearm",
    "abs", "obliques", "quadriceps", "hamstring", "gluteal", "adductors", "calves",
)

/** Weekly working-set targets per muscle (fractional sets). MEV 0 = no minimum worth flagging. */
data class Landmarks(val mev: Int, val mav: Int)

val MUSCLE_LANDMARKS: Map<String, Landmarks> = mapOf(
    "chest" to Landmarks(10, 22),
    "upper-back" to Landmarks(10, 25),
    "deltoids" to Landmarks(8, 22),
    "quadriceps" to Landmarks(8, 18),
    "hamstring" to Landmarks(6, 16),
    "gluteal" to Landmarks(4, 16),
    "biceps" to Landmarks(6, 20),
    "triceps" to Landmarks(6, 18),
    "calves" to Landmarks(0, 16),
    "abs" to Landmarks(0, 16),
    "obliques" to Landmarks(0, 12),
    "trapezius" to Landmarks(0, 16),
    "forearm" to Landmarks(0, 12),
    "lower-back" to Landmarks(0, 10),
    "adductors" to Landmarks(0, 12),
)

/** Muscles a general strength plan should reach at least once a week. */
val KEY_MUSCLES: List<String> = listOf("chest", "upper-back", "deltoids", "quadriceps", "hamstring", "gluteal", "biceps", "triceps", "abs")

/** One well-known, equipment-light exercise per muscle, to suggest when it's missing (uk, en). */
val SUGGESTED_EXERCISE: Map<String, Pair<String, String>> = mapOf(
    "chest" to ("Віджимання" to "Push-up"),
    "upper-back" to ("Тяга гантелі в нахилі" to "Dumbbell row"),
    "deltoids" to ("Махи гантелями в сторони" to "Lateral raise"),
    "quadriceps" to ("Гоблет-присідання" to "Goblet squat"),
    "hamstring" to ("Румунська тяга" to "Romanian deadlift"),
    "gluteal" to ("Ягідний місток" to "Glute bridge"),
    "biceps" to ("Згинання рук з гантелями" to "Dumbbell curl"),
    "triceps" to ("Зворотні віджимання від лави" to "Bench dips"),
    "abs" to ("Планка" to "Plank"),
)

@Serializable data class LoggedExercise(val n: String, val s: Int)

@Serializable data class LoggedDay(
    val date: String,
    val done: Boolean,
    val ex: List<LoggedExercise> = emptyList(),
)

/** Muscle-to-exercise lookup used by every function below (defaults to the shared rules). */
typealias MuscleLookup = (String) -> ExerciseMuscles?

data class MuscleWeek(
    val slug: String,
    val sets: Double,
    val mev: Int,
    val mav: Int,
    val zone: String, // below | optimal | above | none
    val exercises: List<WeekExercise>,
) {
    data class WeekExercise(val name: String, val sets: Double, val secondary: Boolean)
}

/** Half-up rounding, the same as JavaScript's Math.round for the positive values used here. */
internal fun jsRound(x: Double): Double = floor(x + 0.5)

private fun zoneOf(sets: Double, mev: Int, mav: Int): String = when {
    sets <= 0 -> if (mev > 0) "below" else "none"
    sets < mev -> "below"
    sets > mav -> "above"
    else -> "optimal"
}

/** Fractional working sets per muscle over the completed workouts on or after `since`. */
fun weeklyMuscleSets(logs: List<LoggedDay>, since: String, lookup: MuscleLookup = { classify(it) }): List<MuscleWeek> {
    class Row(var sets: Double = 0.0) { val exercises = linkedMapOf<String, MuscleWeek.WeekExercise>() }
    val acc = mutableMapOf<String, Row>()
    fun add(slug: String, name: String, sets: Double, primary: Boolean) {
        val row = acc.getOrPut(slug) { Row() }
        row.sets += if (primary) sets else sets / 2
        val key = name.trim().lowercase()
        val prev = row.exercises[key]
        row.exercises[key] = MuscleWeek.WeekExercise(
            name = name.trim(),
            sets = (prev?.sets ?: 0.0) + sets,
            secondary = if (prev == null) !primary else prev.secondary && !primary,
        )
    }
    for (log in logs) {
        if (!log.done || log.date < since) continue
        for (e in log.ex) {
            if (e.s <= 0) continue
            val m = lookup(e.n) ?: continue
            for (slug in m.primary) add(slug, e.n, e.s.toDouble(), primary = true)
            for (slug in m.secondary) add(slug, e.n, e.s.toDouble(), primary = false)
        }
    }
    return TRACKED_MUSCLES.map { slug ->
        val row = acc[slug]
        val sets = if (row != null) jsRound(row.sets * 2) / 2 else 0.0
        val lm = MUSCLE_LANDMARKS[slug] ?: Landmarks(0, 16)
        val exercises = row?.exercises?.values?.sortedWith { a, b ->
            when {
                a.secondary == b.secondary -> b.sets.compareTo(a.sets)
                !a.secondary -> -1
                else -> 1
            }
        }.orEmpty()
        MuscleWeek(slug, sets, lm.mev, lm.mav, zoneOf(sets, lm.mev, lm.mav), exercises)
    }
}

data class MuscleRecovery(
    val slug: String,
    val status: String, // recovering | almost | ready
    val daysAgo: Int?, // null = not trained in the window
    val primary: Boolean?, // how that workout loaded it; null when not trained
    val exercises: List<String>,
)

private fun statusFor(days: Int, primary: Boolean): String {
    val d = if (primary) days else days + 1
    return when {
        d <= 1 -> "recovering"
        d == 2 -> "almost"
        else -> "ready"
    }
}

/** How recovered each tracked muscle is, from the days since it was last trained (see muscleLoad.ts). */
fun muscleRecovery(logs: List<LoggedDay>, today: String, lookup: MuscleLookup = { classify(it) }): List<MuscleRecovery> {
    val sorted = logs.filter { it.date <= today }.sortedWith { a, b -> b.date.compareTo(a.date) }
    return TRACKED_MUSCLES.map { slug ->
        var primaryDay: Pair<String, MutableList<String>>? = null
        var secondaryDay: Pair<String, MutableList<String>>? = null
        for (log in sorted) {
            for (e in log.ex) {
                if (e.s <= 0) continue
                val m = lookup(e.n) ?: continue
                when {
                    slug in m.primary -> {
                        if (primaryDay == null) primaryDay = log.date to mutableListOf()
                        if (primaryDay.first == log.date) primaryDay.second.add(e.n.trim())
                    }
                    slug in m.secondary -> {
                        if (secondaryDay == null) secondaryDay = log.date to mutableListOf()
                        if (secondaryDay.first == log.date) secondaryDay.second.add(e.n.trim())
                    }
                }
            }
            if (primaryDay != null && secondaryDay != null) break
        }
        val rank = mapOf("recovering" to 0, "almost" to 1, "ready" to 2)
        class Candidate(val primary: Boolean, val date: String, val exercises: List<String>, val days: Int, val status: String)
        val candidates = listOfNotNull(
            primaryDay?.let { (date, ex) -> Candidate(true, date, ex, date.daysUntilIso(today), statusFor(date.daysUntilIso(today), true)) },
            secondaryDay?.let { (date, ex) -> Candidate(false, date, ex, date.daysUntilIso(today), statusFor(date.daysUntilIso(today), false)) },
        ).sortedWith { a, b -> (rank.getValue(a.status) - rank.getValue(b.status)).takeIf { it != 0 } ?: (a.days - b.days) }
        val worst = candidates.firstOrNull() ?: return@map MuscleRecovery(slug, "ready", null, null, emptyList())
        MuscleRecovery(slug, worst.status, worst.days, worst.primary, worst.exercises.distinct())
    }
}

/** Antagonist pairs that should be trained in proportion. */
private val BALANCE_PAIRS = listOf("chest" to "upper-back", "quadriceps" to "hamstring", "biceps" to "triceps")

data class LopsidedPair(val weak: String, val weakSets: Double, val strong: String, val strongSets: Double)

/** Antagonist pairs where the weaker side gets under half the stronger's volume (and the stronger side has `minStrong` sets). */
fun lopsidedPairs(sets: (String) -> Double, minStrong: Double = 6.0): List<LopsidedPair> = BALANCE_PAIRS.mapNotNull { (a, b) ->
    val (strong, weak) = if (sets(a) >= sets(b)) a to b else b to a
    if (sets(strong) < minStrong || sets(weak) >= sets(strong) / 2) null
    else LopsidedPair(weak, sets(weak), strong, sets(strong))
}

data class MuscleSeries(val weekEnds: List<String>, val series: Map<String, List<Double>>)

/** Fractional sets per tracked muscle for each of the last `weeks` 7-day windows ending on `today` (oldest first). */
fun weeklyMuscleSeries(logs: List<LoggedDay>, today: String, weeks: Int = 12, lookup: MuscleLookup = { classify(it) }): MuscleSeries {
    val end = LocalDate.parse(today)
    val weekEnds = (0 until weeks).map { i -> end.plus((i - (weeks - 1)) * 7, DateTimeUnit.DAY).toString() }
    val buckets = TRACKED_MUSCLES.associateWith { DoubleArray(weeks) }
    for (log in logs) {
        if (!log.done) continue
        val age = log.date.daysUntilIso(today)
        if (age < 0) continue
        val bucket = weeks - 1 - age / 7
        if (bucket < 0) continue
        for (e in log.ex) {
            if (e.s <= 0) continue
            val m = lookup(e.n) ?: continue
            for (slug in m.primary) buckets[slug]?.let { it[bucket] += e.s.toDouble() }
            for (slug in m.secondary) buckets[slug]?.let { it[bucket] += e.s / 2.0 }
        }
    }
    return MuscleSeries(weekEnds, buckets.mapValues { it.value.toList() })
}

data class WeekBalance(val balance: Int, val trainedSets: Double)

/** The week's muscle balance score (0-100, key muscles against their minimum) and total fractional sets. */
fun weekBalance(logs: List<LoggedDay>, since: String, lookup: MuscleLookup = { classify(it) }): WeekBalance {
    val week = weeklyMuscleSets(logs, since, lookup)
    val keys = KEY_MUSCLES.mapNotNull { slug -> week.firstOrNull { it.slug == slug } }
    val credit = keys.map { m -> if (m.mev > 0) min(1.0, m.sets / m.mev) else if (m.sets >= 1) 1.0 else 0.0 }
    val balance = if (keys.isEmpty()) 0 else jsRound(credit.sum() / keys.size * 100).toInt()
    return WeekBalance(balance, week.sumOf { it.sets })
}

/** Days from this ISO date to `to` (negative if `to` is earlier). */
internal fun String.daysUntilIso(to: String): Int = LocalDate.parse(this).daysUntil(LocalDate.parse(to))

internal fun isoPlusDays(iso: String, n: Int): String = LocalDate.parse(iso).plus(n, DateTimeUnit.DAY).toString()
