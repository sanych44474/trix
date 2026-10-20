package app.hacklimits.shared.plan

import app.hacklimits.shared.data.Plan
import kotlin.math.floor

// Port of src/domain/muscleLoad.ts (plan balance) and the name lookup of src/domain/exerciseMuscles.ts.
// The server-learned muscle classifications of custom exercises are not on the device, so names the
// rules do not recognise simply do not count toward the balance check.

internal data class ExerciseMuscles(val primary: List<String>, val secondary: List<String>)

internal fun musclesForExercise(name: String): ExerciseMuscles? {
    val n = name.lowercase()
    for (rule in MUSCLE_RULES) {
        if (rule.regex.containsMatchIn(n)) return ExerciseMuscles(rule.primary, rule.secondary.filter { it !in rule.primary })
    }
    for (rule in REGION_FALLBACK_RULES) {
        if (rule.regex.containsMatchIn(n)) return ExerciseMuscles(rule.primary, emptyList())
    }
    return null
}

private val KEY_MUSCLES = listOf("chest", "upper-back", "deltoids", "quadriceps", "hamstring", "gluteal", "biceps", "triceps", "abs")
private val BALANCE_PAIRS = listOf("chest" to "upper-back", "quadriceps" to "hamstring", "biceps" to "triceps")

/** One well-known, equipment-light exercise per muscle, to suggest when it's missing. */
internal data class SuggestedExercise(val uk: String, val en: String)

private val SUGGESTED_EXERCISE = mapOf(
    "chest" to SuggestedExercise("Віджимання", "Push-up"),
    "upper-back" to SuggestedExercise("Тяга гантелі в нахилі", "Dumbbell row"),
    "deltoids" to SuggestedExercise("Махи гантелями в сторони", "Lateral raise"),
    "quadriceps" to SuggestedExercise("Гоблет-присідання", "Goblet squat"),
    "hamstring" to SuggestedExercise("Румунська тяга", "Romanian deadlift"),
    "gluteal" to SuggestedExercise("Ягідний місток", "Glute bridge"),
    "biceps" to SuggestedExercise("Згинання рук з гантелями", "Dumbbell curl"),
    "triceps" to SuggestedExercise("Зворотні віджимання від лави", "Bench dips"),
    "abs" to SuggestedExercise("Планка", "Plank"),
)

/** Which muscles naturally share a training day (the day a suggestion should go to). */
private val DAY_FAMILY = mapOf(
    "chest" to listOf("chest", "triceps", "deltoids"),
    "triceps" to listOf("chest", "triceps", "deltoids"),
    "deltoids" to listOf("deltoids", "chest", "triceps", "upper-back"),
    "upper-back" to listOf("upper-back", "biceps", "trapezius"),
    "biceps" to listOf("upper-back", "biceps", "forearm"),
    "quadriceps" to listOf("quadriceps", "gluteal", "hamstring", "calves"),
    "hamstring" to listOf("hamstring", "gluteal", "quadriceps", "lower-back"),
    "gluteal" to listOf("gluteal", "hamstring", "quadriceps"),
    "abs" to listOf("abs", "obliques"),
)

internal enum class BalanceKind { MISSING, IMBALANCE }

internal data class BalanceSuggestion(val uk: String, val en: String, val weekday: Int)

/** An under-trained muscle; for an imbalance, [otherSlug]/[otherSets] name the stronger side. */
internal data class BalanceIssue(
    val kind: BalanceKind,
    val slug: String,
    val sets: Double,
    val otherSlug: String? = null,
    val otherSets: Double = 0.0,
    val suggestion: BalanceSuggestion? = null,
)

/** A time or distance with no "N x" in front ("20-25 min", "5 km"): one block of cardio. */
private val DURATION_ONLY = Regex(
    """^(?!.*[×x*х]\s*\d).*\d\s*(min|хв|мин|sec|сек|с|s|km|км|m|м)(?!\p{L})""",
    RegexOption.IGNORE_CASE,
)

/** "4 × 8–10" -> 4; a duration or distance is one set; anything unparseable counts as 3 sets. */
internal fun planSetCount(sets: String?): Int {
    val s = sets.orEmpty()
    if (DURATION_ONLY.containsMatchIn(s.lowercase())) return 1
    val n = Regex("^\\d+").find(s.trim())?.value?.toIntOrNull() ?: return 3
    return if (n in 1..20) n else 3
}

/** Rounds to the nearest half set (JavaScript Math.round semantics for the .5 case). */
private fun halfSet(x: Double): Double = floor(x * 2 + 0.5) / 2

/**
 * What a strength plan leaves out or lopsided: key muscles with under one effective set a week, and
 * antagonist pairs where one side gets under half the other's volume (only when the stronger side
 * has at least 6 sets). Plans with barely any mappable strength work are not judged.
 */
internal fun planBalance(days: List<Plan.Day>): List<BalanceIssue> {
    val total = HashMap<String, Double>()
    val perDay = HashMap<Int, HashMap<String, Double>>()
    var mapped = 0
    for (day in days) {
        val dayMap = HashMap<String, Double>()
        for (ex in day.exercises) {
            val m = musclesForExercise(ex.name) ?: continue
            mapped++
            val n = planSetCount(ex.sets).toDouble()
            for (slug in m.primary) dayMap[slug] = (dayMap[slug] ?: 0.0) + n
            for (slug in m.secondary) dayMap[slug] = (dayMap[slug] ?: 0.0) + n / 2
        }
        perDay[day.weekday] = dayMap
        for ((slug, n) in dayMap) total[slug] = (total[slug] ?: 0.0) + n
    }
    if (mapped < 4 || days.isEmpty()) return emptyList()
    fun sets(slug: String): Double = halfSet(total[slug] ?: 0.0)

    fun suggest(slug: String): BalanceSuggestion? {
        val s = SUGGESTED_EXERCISE[slug] ?: return null
        val family = DAY_FAMILY[slug] ?: listOf(slug)
        val best = days
            .map { d -> Triple(d.weekday, family.sumOf { perDay[d.weekday]?.get(it) ?: 0.0 }, d.exercises.size) }
            .sortedWith(compareByDescending<Triple<Int, Double, Int>> { it.second }.thenBy { it.third }.thenBy { it.first })
            .first()
        return BalanceSuggestion(s.uk, s.en, best.first)
    }

    val issues = mutableListOf<BalanceIssue>()
    for (slug in KEY_MUSCLES) {
        if (sets(slug) < 1) issues += BalanceIssue(BalanceKind.MISSING, slug, sets(slug), suggestion = suggest(slug))
    }
    val flagged = issues.map { it.slug }.toSet()
    for ((a, b) in BALANCE_PAIRS) {
        val (strong, weak) = if (sets(a) >= sets(b)) a to b else b to a
        if (sets(strong) < 6 || sets(weak) >= sets(strong) / 2) continue
        if (weak in flagged) continue
        issues += BalanceIssue(BalanceKind.IMBALANCE, weak, sets(weak), strong, sets(strong), suggest(weak))
    }
    return issues
}

/** Rep range and intensity for a block phase (src/domain/mesocycle.ts phaseGuidance, shown in the app). */
internal data class MesoGuidance(val reps: String, val intensity: String)

internal fun mesoGuidance(phase: String): MesoGuidance = when (phase) {
    "hypertrophy" -> MesoGuidance("8–12", "RPE 7–8")
    "strength" -> MesoGuidance("3–6", "RPE 8–9")
    "peak" -> MesoGuidance("1–3", "RPE 9–10")
    else -> MesoGuidance("8–10", "RPE 5–6")
}
