package app.hacklimits.shared.progress.muscle

import kotlinx.serialization.Serializable

// Which muscles an exercise works, for the body map: primary movers and secondary helpers, in the
// figure's vocabulary (see progress/body). Port of src/domain/exerciseMuscles.ts; the rule table
// itself is generated into ExerciseRules.kt. The server's learned classifications (dashboard
// calendar.learnedMuscles) fill gaps the rules don't cover.

data class ExerciseMuscles(val primary: List<String>, val secondary: List<String>)

@Serializable data class LearnedMuscles(val name: String, val primary: List<String> = emptyList(), val secondary: List<String> = emptyList())

val ALL_MUSCLE_SLUGS: Set<String> = setOf(
    "abs", "adductors", "biceps", "calves", "chest", "deltoids", "forearm", "gluteal",
    "hamstring", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius",
    "triceps", "upper-back",
)

private val learned = mutableMapOf<String, ExerciseMuscles>()

/** Replaces the learned table with the server's view (only known slugs; a name with no primary teaches nothing). */
fun registerLearnedMuscles(entries: List<LearnedMuscles>) {
    for (e in entries) {
        val primary = e.primary.filter { it in ALL_MUSCLE_SLUGS }.distinct()
        if (primary.isEmpty()) continue
        val secondary = e.secondary.filter { it in ALL_MUSCLE_SLUGS && it !in primary }.distinct()
        learned[normalizeExerciseName(e.name)] = ExerciseMuscles(primary, secondary)
    }
}

fun normalizeExerciseName(name: String): String = name.trim().lowercase().replace(Regex("\\s+"), " ")

fun musclesForExercise(name: String): ExerciseMuscles? {
    val n = name.lowercase()
    for (rule in EXERCISE_RULES) {
        if (rule.pattern.containsMatchIn(n)) return ExerciseMuscles(rule.primary, rule.secondary.filter { it !in rule.primary })
    }
    // A learned classification beats a guess from a region word in the name.
    learned[normalizeExerciseName(name)]?.let { return it }
    for (rule in REGION_FALLBACK) {
        if (rule.pattern.containsMatchIn(n)) return ExerciseMuscles(rule.primary, emptyList())
    }
    return null
}
