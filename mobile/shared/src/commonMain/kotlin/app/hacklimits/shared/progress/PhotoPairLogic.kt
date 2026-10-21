package app.hacklimits.shared.progress

import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.ProgressDashboard
import kotlinx.datetime.LocalDate
import kotlinx.datetime.daysUntil
import kotlin.math.abs
import kotlin.math.roundToInt

// Which two progress photos to show side by side: the newest, and the one closest to 30 days before
// it, plus the weight logged nearest each photo's date. Port of logic/photoPair.ts.

data class PhotoPair(val before: PhotoRef, val after: PhotoRef, val days: Int)

private fun epochDay(iso: String): Long? = runCatching { LocalDate(1970, 1, 1).daysUntil(LocalDate.parse(iso.take(10))).toLong() }.getOrNull()

fun pickPhotoPair(photos: List<PhotoRef>, targetDays: Int = 30): PhotoPair? {
    val sorted = photos.mapNotNull { p -> epochDay(p.takenAt)?.let { p to it } }.sortedBy { it.second }
    if (sorted.size < 2) return null
    val (after, afterDay) = sorted.last()
    val goal = afterDay - targetDays
    val earlier = sorted.dropLast(1).filter { it.second < afterDay }
    if (earlier.isEmpty()) return null
    val (before, beforeDay) = earlier.reduce { best, cur -> if (abs(cur.second - goal) < abs(best.second - goal)) cur else best }
    return PhotoPair(before, after, (afterDay - beforeDay).toInt())
}

/** The weight logged within `maxDays` of `date`, nearest first (null if none). */
fun weightNear(points: List<ProgressDashboard.Weight.Point>, date: String, maxDays: Int = 3): Double? {
    val target = epochDay(date) ?: return null
    var best: ProgressDashboard.Weight.Point? = null
    var bestDistance = Long.MAX_VALUE
    for (p in points) {
        val day = epochDay(p.date) ?: continue
        val d = abs(day - target)
        if (d <= maxDays && d < bestDistance) {
            best = p
            bestDistance = d
        }
    }
    return best?.kg
}

/** Kilograms with at most one decimal, as the Mini App prints them. */
fun formatOneDecimal(value: Double): String {
    val tenths = (value * 10).roundToInt()
    return if (tenths % 10 == 0) (tenths / 10).toString() else "${tenths / 10}.${abs(tenths % 10)}"
}
