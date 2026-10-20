package app.hacklimits.shared.workout.logic

import app.hacklimits.shared.data.AppJson
import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Rest timer and session-quality rules (port of apps/mini-app/src/logic/rest.ts). Pure: every time
// is a parameter.

const val DEFAULT_REST_SEC = 60
const val REST_MIN_SEC = 30
const val REST_MAX_SEC = 900
/** Stop counting up eventually, so a rest left running doesn't pin the bar forever. */
const val REST_OVERRUN_CAP_SEC = 300
const val REST_ADJUST_SEC = 15
/** A rest counts as "on target" if it ended within this of the planned length. */
const val REST_ON_TARGET_TOLERANCE_SEC = 15

@Serializable
data class RestPrefs(
    val reps: Int = DEFAULT_REST_SEC,
    val time: Int = DEFAULT_REST_SEC,
    val distance: Int = DEFAULT_REST_SEC,
    val sound: Boolean = false,
    val auto: Boolean = true,
) {
    fun forMetric(metric: String): Int = when (restMetricKey(metric)) {
        "time" -> time
        "distance" -> distance
        else -> reps
    }

    fun withMetric(metric: String, seconds: Int): RestPrefs = when (restMetricKey(metric)) {
        "time" -> copy(time = seconds)
        "distance" -> copy(distance = seconds)
        else -> copy(reps = seconds)
    }
}

/** `M:SS`, used for both the countdown and the overrun. */
fun fmtRest(sec: Int): String {
    val safe = max(0, sec)
    return "${safe / 60}:${(safe % 60).toString().padStart(2, '0')}"
}

/** A whole-session length: "m:ss" under an hour, "h:mm:ss" past it. */
fun fmtDuration(sec: Int): String {
    val safe = max(0, sec)
    if (safe < 3600) return fmtRest(safe)
    return "${safe / 3600}:${((safe % 3600) / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}"
}

fun clampRest(seconds: Int): Int {
    val s = if (seconds == 0) DEFAULT_REST_SEC else seconds
    return s.coerceIn(REST_MIN_SEC, REST_MAX_SEC)
}

/** Which remembered rest applies: a timed hold and a heavy compound want different rests. */
fun restMetricKey(metric: String?): String = when (metric) {
    "time" -> "time"
    "distance" -> "distance"
    else -> "reps"
}

/** Stored preferences, parsed defensively: a missing or hand-edited value falls back to defaults. */
fun parseRestPrefs(raw: String?): RestPrefs {
    if (raw.isNullOrBlank()) return RestPrefs()
    return runCatching {
        val p = AppJson.decodeFromString<RestPrefs>(raw)
        p.copy(reps = clampRest(p.reps), time = clampRest(p.time), distance = clampRest(p.distance))
    }.getOrDefault(RestPrefs())
}

@Serializable
data class SessionQuality(
    val restCount: Int = 0,
    val restTotalSec: Int = 0,
    val onTargetStreak: Int = 0,
    val bestStreak: Int = 0,
)

/** Fold one finished rest into the session's running quality. [actualSec] is the REAL rest,
 * overrun included, so overshooting the timer is what gets surfaced. */
fun scoreRest(current: SessionQuality, actualSec: Int, targetSec: Int): SessionQuality {
    val onTarget = abs(actualSec - targetSec) <= REST_ON_TARGET_TOLERANCE_SEC
    val streak = if (onTarget) current.onTargetStreak + 1 else 0
    return SessionQuality(
        restCount = current.restCount + 1,
        restTotalSec = current.restTotalSec + max(0, actualSec),
        onTargetStreak = streak,
        bestStreak = max(current.bestStreak, streak),
    )
}

/** Share of elapsed session time spent working, 0-100. Null before there is a session to measure. */
fun density(startedAtMs: Long?, restTotalSec: Int, nowMs: Long): Int? {
    if (startedAtMs == null) return null
    val elapsed = max(1, ((nowMs - startedAtMs) / 1000.0).roundToInt())
    return ((elapsed - restTotalSec).toDouble() / elapsed * 100).roundToInt().coerceIn(0, 100)
}

data class RestTick(val left: Int, val over: Int, val done: Boolean)

/** Seconds left and seconds past zero, from one absolute deadline. */
fun restProgress(endAtMs: Long, nowMs: Long): RestTick {
    val deltaMs = endAtMs - nowMs
    if (deltaMs > 0) return RestTick(left = ceil(deltaMs / 1000.0).toInt(), over = 0, done = false)
    return RestTick(left = 0, over = max(0, floor(-deltaMs / 1000.0).toInt()), done = true)
}

/** Ring fill for the rest bar, 0-100, measured against the rest's ORIGINAL length. */
fun restRingPct(targetSec: Int, leftSec: Int): Int {
    if (targetSec <= 0) return 100
    return min(100, max(0, ((targetSec - leftSec).toDouble() / targetSec * 100).roundToInt()))
}
