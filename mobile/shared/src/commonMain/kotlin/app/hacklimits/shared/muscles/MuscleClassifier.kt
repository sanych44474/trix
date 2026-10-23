// The one exercise-name classification the native app uses (body map, workout focus, plan balance,
// muscle load). Rules are MuscleRulesGenerated.kt, generated from src/domain/exerciseMuscles.ts; the
// learned table (server or AI answers for names the rules miss) only fills gaps. Golden cases:
// test/fixtures/muscle-classification.json, checked by the TS and Kotlin tests.
package app.hacklimits.shared.muscles

/** Primary movers and secondary helpers, in the body figure's slug vocabulary. */
data class ExerciseMuscles(val primary: List<String>, val secondary: List<String>)

// JS /i flag; inputs are lowercased and patterns are lowercase, so ASCII-only folding is enough.
internal class MuscleRule(pattern: String, val primary: List<String>, val secondary: List<String>) {
    val regex = Regex(pattern, RegexOption.IGNORE_CASE)
}

/** Every slug the body figure knows; anything else from the server or AI is dropped. */
val MUSCLE_SLUGS: Set<String> = setOf(
    "abs", "adductors", "biceps", "calves", "chest", "deltoids", "forearm", "gluteal",
    "hamstring", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius",
    "triceps", "upper-back",
)

fun normalizeExerciseName(name: String): String = name.trim().lowercase().replace(Regex("\\s+"), " ")

/** A learned classification with unknown slugs dropped; null when no known primary muscle survives. */
fun cleanLearned(primary: List<String>, secondary: List<String>): ExerciseMuscles? {
    val p = primary.filter { it in MUSCLE_SLUGS }.distinct()
    if (p.isEmpty()) return null
    return ExerciseMuscles(p, secondary.filter { it in MUSCLE_SLUGS && it !in p }.distinct())
}

/** Learned classifications keyed by normalized name, filled from server and AI answers. */
object MuscleLearning {
    private val table = mutableMapOf<String, ExerciseMuscles>()

    val entries: Map<String, ExerciseMuscles> get() = table

    /** A name with no known primary muscle teaches nothing. */
    fun remember(name: String, primary: List<String>, secondary: List<String>) {
        cleanLearned(primary, secondary)?.let { table[normalizeExerciseName(name)] = it }
    }
}

/**
 * Muscles an exercise name works: the rules first, then a learned entry, then a region word
 * ("вправа на груди"). Null when none applies.
 */
fun classify(name: String, learned: Map<String, ExerciseMuscles> = MuscleLearning.entries): ExerciseMuscles? {
    val n = name.lowercase()
    for (rule in MUSCLE_RULES) {
        if (rule.regex.containsMatchIn(n)) return ExerciseMuscles(rule.primary, rule.secondary.filter { it !in rule.primary })
    }
    learned[normalizeExerciseName(name)]?.let { return it }
    for (rule in REGION_FALLBACK_RULES) {
        if (rule.regex.containsMatchIn(n)) return ExerciseMuscles(rule.primary, emptyList())
    }
    return null
}
