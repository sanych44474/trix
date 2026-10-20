package app.hacklimits.shared.plan

import app.hacklimits.shared.resources.Res
import io.ktor.http.encodeURLPathPart

// Port of apps/mini-app/src/logic/library.ts (search and filter) and the exercise data it reads.

/** One free-exercise-db exercise. [id] is also its image folder; the underscores are the English name. */
data class LibraryEntry(
    val id: String,
    val title: String,
    val titleUk: String,
    /** A body-map slug (chest, upper-back, ...). */
    val muscle: String,
    /** body | dumbbell | barbell | kettlebell | band | cable | machine | ezbar | ball | other */
    val equipment: String,
    /** b (beginner), i (intermediate) or e (expert). */
    val level: String,
)

/** Parses "id|muscle|equipment|level|uk" lines (the packed library shipped as composeResources/files). */
fun parseLibrary(packed: String): List<LibraryEntry> =
    packed.lineSequence().filter { it.isNotBlank() }.map { line ->
        val parts = line.split("|")
        val id = parts[0]
        val title = id.replace('_', ' ')
        val uk = parts.getOrNull(4)
        LibraryEntry(
            id = id,
            title = title,
            titleUk = if (uk.isNullOrEmpty()) title else uk,
            muscle = parts.getOrElse(1) { "" },
            equipment = parts.getOrElse(2) { "other" },
            level = parts.getOrNull(3)?.takeIf { it == "i" || it == "e" } ?: "b",
        )
    }.toList()

// Ukrainian (and a few Russian) movement words -> the English words the names use, so "присідання з
// гантелями" finds "Dumbbell Squat". Stems, matched at the start of a query word.
private val UA_WORDS: List<Pair<Regex, List<String>>> = listOf(
    Regex("^присід|^присед") to listOf("squat"),
    Regex("^випад|^выпад") to listOf("lunge"),
    Regex("^жим") to listOf("press"),
    Regex("^тяг") to listOf("row", "pull", "deadlift"),
    Regex("^станов") to listOf("deadlift"),
    Regex("^румун") to listOf("romanian"),
    Regex("^згинан|^сгибан") to listOf("curl"),
    Regex("^розгинан|^разгибан") to listOf("extension", "pushdown"),
    Regex("^віджим|^отжим") to listOf("push-up", "pushup"),
    Regex("^підтяг|^подтяг") to listOf("pull-up", "pullup", "chin"),
    Regex("^планк") to listOf("plank"),
    Regex("^скруч|^прес") to listOf("crunch", "sit-up"),
    Regex("^мах|^розвед|^развед") to listOf("raise", "fly", "flye"),
    Regex("^міст|^мост") to listOf("bridge", "thrust"),
    Regex("^гантел") to listOf("dumbbell"),
    Regex("^штанг") to listOf("barbell"),
    Regex("^гир") to listOf("kettlebell"),
    Regex("^блок|^кросовер|^кроссовер|^трос") to listOf("cable"),
    Regex("^тренажер") to listOf("machine", "lever"),
    Regex("^литк|^носк|^икр") to listOf("calf"),
    Regex("^шраг") to listOf("shrug"),
    Regex("^пуловер") to listOf("pullover"),
    Regex("^гіперекст|^гиперэкст") to listOf("hyperextension"),
    Regex("^берпі|^бёрпи|^берпи") to listOf("burpee"),
    Regex("^стрибк|^прыж") to listOf("jump"),
    Regex("^молот") to listOf("hammer"),
    Regex("^француз") to listOf("skull", "lying triceps"),
    Regex("^біг|^бег") to listOf("run", "jog"),
)

private val CYRILLIC = Regex("[а-яіїєґ]")

// Each query word: itself (matched in the English or Ukrainian name) plus, for a known movement stem,
// its English words; a Ukrainian word also matches by its first 5 letters, so "гантелями" finds
// "з гантелями" and "гантелі" alike.
private fun queryWords(query: String): List<List<String>> =
    query.lowercase().split(Regex("\\s+")).filter { it.length >= 2 }.map { w ->
        val mapped = UA_WORDS.firstOrNull { (re, _) -> re.containsMatchIn(w) }?.second.orEmpty()
        val stem = if (CYRILLIC.containsMatchIn(w) && w.length > 5) w.take(5) else w
        listOf(stem) + mapped
    }

private fun levelRank(level: String): Int = when (level) {
    "b" -> 0
    "i" -> 1
    else -> 2
}

/** Every query word must match (any of its alternatives) somewhere in the English or Ukrainian name. */
fun filterLibrary(all: List<LibraryEntry>, muscle: String = "", equipment: String = "", query: String = ""): List<LibraryEntry> {
    val words = if (query.isNotBlank()) queryWords(query) else emptyList()
    return all.filter { e ->
        if (muscle.isNotEmpty() && e.muscle != muscle) return@filter false
        if (equipment.isNotEmpty() && e.equipment != equipment) return@filter false
        if (words.isEmpty()) return@filter true
        val name = "${e.title}|${e.titleUk}".lowercase()
        words.all { alts -> alts.any { name.contains(it) } }
    }.sortedWith(compareBy<LibraryEntry> { levelRank(it.level) }.thenBy { it.title.lowercase() })
}

/** Both frames of an exercise, from jsDelivr's GitHub CDN at the pinned free-exercise-db commit. */
fun exerciseFrameUrls(id: String): List<String> {
    val base = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@$FREE_EXERCISE_DB_COMMIT/exercises/${id.encodeURLPathPart()}"
    return listOf("$base/0.jpg", "$base/1.jpg")
}

private const val FREE_EXERCISE_DB_COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5"

/** The 750 exercises, read once from the bundled data file. */
object ExerciseCatalog {
    private var cached: List<LibraryEntry>? = null

    suspend fun all(): List<LibraryEntry> {
        cached?.let { return it }
        val text = Res.readBytes("files/exercise_library.txt").decodeToString()
        return parseLibrary(text).also { cached = it }
    }
}
