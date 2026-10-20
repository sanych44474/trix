package app.hacklimits.shared.progress.body

import androidx.compose.ui.graphics.Color
import app.hacklimits.shared.data.TrainingPlanDay
import app.hacklimits.shared.progress.muscle.ExerciseMuscles

// Body-map data: which muscles each selection colours, and the exercise picker's groups.
// Port of logic/bodyMap.ts (the parts the Progress screen uses).

val ZONE_COLORS: Map<String, Color> = mapOf(
    "below" to Color(0xFF7D879B),
    "optimal" to Color(0xFFFF5F3D),
    "above" to Color(0xFFFFB020),
)
val PRIMARY_COLOR = Color(0xFFFF5F3D)
val SECONDARY_COLOR = Color(0xFFFFB4A1)

val RECOVERY_COLORS: Map<String, Color> = mapOf(
    "recovering" to Color(0xFFEF4444),
    "almost" to Color(0xFFF5B301),
    "ready" to Color(0xFF22C55E),
)

/** A muscle to paint on the figure. */
data class BodyPart(val slug: String, val color: Color)

/** A training day's muscles: primary movers, assisting muscles (not already primary), and names with no muscle data. */
data class DayMuscles(val primary: List<String>, val secondary: List<String>, val unknown: List<String>)

fun dayMuscles(names: List<String>, lookup: (String) -> ExerciseMuscles?): DayMuscles {
    val primary = mutableListOf<String>()
    val secondary = mutableListOf<String>()
    val unknown = mutableListOf<String>()
    for (name in names) {
        val m = lookup(name)
        if (m == null) {
            unknown.add(name)
            continue
        }
        for (slug in m.primary) if (slug !in primary) primary.add(slug)
        for (slug in m.secondary) if (slug !in secondary) secondary.add(slug)
    }
    return DayMuscles(primary, secondary.filter { it !in primary }, unknown)
}

/** One group of the exercise picker: a plan day (weekday 1..7) or the recently logged extras (weekday null). */
data class PickerGroup(
    val weekday: Int?,
    val title: String,
    val names: List<String>, // exercises not already listed under an earlier day
    val dayNames: List<String>, // every exercise of the plan day, for "whole day"
)

/** The body map's exercise dropdown: the plan's exercises grouped by training day, then recent extras. Each name appears once. */
fun pickerGroups(days: List<TrainingPlanDay>, recent: List<String>): List<PickerGroup> {
    val seen = mutableSetOf<String>()
    fun take(name: String): Boolean {
        val key = name.trim().lowercase()
        if (key.isEmpty() || !seen.add(key)) return false
        return true
    }
    val groups = days.sortedBy { it.weekday }.map { day ->
        val dayNames = day.exercises.map { it.name.trim() }.filter { it.isNotEmpty() }.distinct()
        PickerGroup(day.weekday, day.muscleGroup ?: day.name ?: "", dayNames.filter(::take), dayNames)
    }.filter { it.dayNames.isNotEmpty() }.toMutableList()
    val extra = recent.filter(::take)
    if (extra.isNotEmpty()) groups.add(PickerGroup(null, "", extra, emptyList()))
    return groups
}

/** Recently logged exercise names, newest first, de-duplicated case-insensitively (at most `limit`). */
fun recentExerciseNames(logs: List<app.hacklimits.shared.progress.muscle.LoggedDay>, limit: Int = 16): List<String> {
    val seen = mutableSetOf<String>()
    val out = mutableListOf<String>()
    for (log in logs.sortedByDescending { it.date }) {
        for (e in log.ex) {
            val key = e.n.trim().lowercase()
            if (key.isEmpty() || !seen.add(key)) continue
            out.add(e.n.trim())
            if (out.size >= limit) return out
        }
    }
    return out
}

/** The figure's muscle slugs, in the order the asset draws them. */
val FIGURE_SLUGS: List<String> = listOf(
    "abs", "adductors", "biceps", "calves", "chest", "deltoids", "feet", "forearm", "gluteal", "hamstring",
    "hands", "hair", "head", "knees", "lower-back", "neck", "obliques", "quadriceps", "tibialis", "trapezius", "triceps", "upper-back",
)

/** Slugs a tap on the figure reports (the ones with a label). */
val TAPPABLE_SLUGS: Set<String> = setOf(
    "abs", "adductors", "biceps", "calves", "chest", "deltoids", "forearm", "gluteal", "hamstring", "lower-back",
    "neck", "obliques", "quadriceps", "tibialis", "trapezius", "triceps", "upper-back",
)
