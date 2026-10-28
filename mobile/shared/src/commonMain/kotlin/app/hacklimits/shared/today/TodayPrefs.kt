package app.hacklimits.shared.today

import app.hacklimits.shared.data.AccountCache
import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.workout.logic.DRAFT_KEY
import app.hacklimits.shared.workout.logic.isSetFilled
import app.hacklimits.shared.workout.logic.parseDraft
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlin.math.roundToLong

/** Today's per-device state: the "more" section, the badges already celebrated, the last-week card
 * dismissed, and the workout in progress (read only, from the account cache the logger writes). Every access
 * is optional: a failed read reads as "nothing stored" and a failed write is dropped. */
class TodayPrefs(private val store: KeyValueStore, private val cache: AccountCache) {
    suspend fun moreOpen(): Boolean = read(MORE_KEY) == "1"
    suspend fun setMoreOpen(open: Boolean) = write(MORE_KEY, if (open) "1" else "0")

    /** The raw stored list of celebrated badge codes; null on a first run. */
    suspend fun seenBadges(): String? = read(BADGES_KEY)
    suspend fun saveSeenBadges(seen: List<String>) = write(BADGES_KEY, AppJson.encodeToString(seen))

    /** The week start the last-week card was dismissed for. */
    suspend fun weekSummarySeen(): String? = read(SUMMARY_KEY)
    suspend fun setWeekSummarySeen(weekStart: String) = write(SUMMARY_KEY, weekStart)

    suspend fun session(): SessionProgress? {
        val draft = parseDraft(runCatching { cache.read(DRAFT_KEY) }.getOrNull())?.takeIf { it.logDate == null } ?: return null
        return SessionProgress(
            draft.date,
            draft.exercises.map { SessionProgress.SessionExercise(it.name, it.done.count(::isSetFilled)) },
        )
    }

    private suspend fun read(key: String): String? = runCatching { store.get(key) }.getOrNull()
    private suspend fun write(key: String, value: String) {
        runCatching { store.put(key, value) }
    }

    companion object {
        const val MORE_KEY = "today_more_open"
        const val BADGES_KEY = "today_badges_seen"
        const val SUMMARY_KEY = "today_week_summary_seen"
    }
}

/** One decimal at most, no trailing ".0" (the Mini App formats with maximumFractionDigits: 1). */
fun formatDecimal(n: Double): String {
    val tenths = (n * 10).roundToLong()
    return if (tenths % 10 == 0L) (tenths / 10).toString() else (tenths / 10.0).toString()
}

/** Halves, as the week card's quest progress shows them ("2.5", "3"). */
fun formatHalf(n: Double): String {
    val halves = (n * 2).roundToLong()
    return if (halves % 2 == 0L) (halves / 2).toString() else "${halves / 2}.5"
}
