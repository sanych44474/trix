package app.hacklimits.shared.workout.logic

import io.ktor.http.encodeURLPathPart

// Name-based classifiers for the logger: how an exercise is measured and which technique pictures
// match it. Ports of src/domain/metricNames.ts and apps/mini-app/src/logic/exerciseImages.ts.
// Muscles come from app.hacklimits.shared.muscles.classify.

private val TIME_NAME_RE = Regex(
    """планк|вис(?![а-яії])|утриман|статичн|холлоу|\b(?:plank|dead ?hang|bar hang|hang|wall ?sit|hollow ?hold|l-?sit|iso(?:metric)? ?hold)\b""",
    RegexOption.IGNORE_CASE,
)
private val DISTANCE_NAME_RE = Regex(
    """гребл|гребн|веслуванн|біг|пробіжк|доріж|велотренаж|велосипед(?!.*(скруч|лежач))|еліпт|еліпс|степер|плаванн|\b(?:rowing machine|row(?:ing)? erg|rower|ergometer|treadmill|running|run|jog(?:ging)?|cycling|spin bike|bike|elliptical|ski ?erg|stair ?(?:climber|master)|swimming|swim)\b""",
    RegexOption.IGNORE_CASE,
)
private val CARDIO_EXACT_NAME_RE = Regex(
    """^\s*(?:rowing|walking|walk|hiking|hike|ходьба|прогулянка|похід)\s*$""",
    RegexOption.IGNORE_CASE,
)

/** The metric a name implies when nothing else is known (a swapped-in exercise). */
fun metricFromName(name: String): String = when {
    DISTANCE_NAME_RE.containsMatchIn(name) || CARDIO_EXACT_NAME_RE.containsMatchIn(name) -> "distance"
    TIME_NAME_RE.containsMatchIn(name) -> "time"
    else -> "reps"
}

enum class Slug(val key: String) {
    ABS("abs"), ADDUCTORS("adductors"), BICEPS("biceps"), CALVES("calves"), CHEST("chest"),
    DELTOIDS("deltoids"), FOREARM("forearm"), GLUTEAL("gluteal"), HAMSTRING("hamstring"),
    LOWER_BACK("lower-back"), NECK("neck"), OBLIQUES("obliques"), QUADRICEPS("quadriceps"),
    TIBIALIS("tibialis"), TRAPEZIUS("trapezius"), TRICEPS("triceps"), UPPER_BACK("upper-back");

    companion object {
        fun ofKey(key: String): Slug? = entries.firstOrNull { it.key == key }
    }
}

data class ExerciseImageMatch(val id: String, val title: String, val exact: Boolean)

/** Technique pictures (free-exercise-db, Unlicense): an exact name match first, then the closest movement. */
object ExerciseImages {
    private val known: Set<String> by lazy { FreeExerciseIds.ALL.toSet() }
    private val exactIndex: Map<String, String> by lazy {
        val index = HashMap<String, String>()
        for (id in FreeExerciseIds.ALL) {
            val key = normalize(titleOf(id))
            if (key.isNotEmpty() && key !in index) index[key] = id
        }
        index
    }

    fun match(name: String, canonicalName: String?): ExerciseImageMatch? {
        for (candidate in listOf(canonicalName, name)) {
            if (candidate.isNullOrEmpty()) continue
            exactIndex[normalize(candidate)]?.let { return ExerciseImageMatch(it, titleOf(it), exact = true) }
        }
        val text = "${canonicalName ?: ""} $name".lowercase()
        for ((re, id) in IMAGE_RULES) {
            if (re.containsMatchIn(text) && id in known) return ExerciseImageMatch(id, titleOf(id), exact = false)
        }
        return null
    }

    /** Both frames of an exercise, served from jsDelivr's GitHub CDN at the pinned commit. */
    fun urls(id: String): List<String> {
        val base = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@${FreeExerciseIds.COMMIT}/exercises/${id.encodeURLPathPart()}"
        return listOf("$base/0.jpg", "$base/1.jpg")
    }

    private fun titleOf(id: String): String = id.replace('_', ' ')

    private fun normalize(name: String): String = name.lowercase()
        .split(Regex("[^a-z0-9]+"))
        .filter { it.isNotEmpty() }
        .joinToString("") { w -> if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w.dropLast(1) else w }
}
