package app.hacklimits.shared.integrations

import app.hacklimits.shared.data.AppJson
import kotlinx.serialization.Serializable

/**
 * The phone's step counter (Android TYPE_STEP_COUNTER) counts every step since the last reboot, not
 * per day. Today's steps are the counter minus where it stood when today began, so the first
 * reading of each day is remembered here. A reboot resets the counter to zero mid-day: the steps
 * counted before it are kept in [carried].
 */
@Serializable
data class StepBaseline(
    /** The local date this baseline belongs to (yyyy-MM-dd). */
    val date: String,
    /** The counter value when today's counting started. */
    val start: Long,
    /** The last counter value seen, to notice a reboot (the counter going backwards). */
    val last: Long,
    /** Steps already counted today before a reboot. */
    val carried: Long = 0,
)

data class StepReading(val baseline: StepBaseline, val stepsToday: Long)

/** Pure: the new baseline and today's steps for a counter reading. The first reading of a day counts 0. */
fun readSteps(previous: StepBaseline?, today: String, counter: Long): StepReading {
    val total = counter.coerceAtLeast(0)
    val base = when {
        previous == null || previous.date != today -> StepBaseline(today, start = total, last = total)
        // The counter went backwards: the phone rebooted. Keep what was counted and start again from 0.
        total < previous.last -> previous.copy(start = 0, last = total, carried = previous.carried + (previous.last - previous.start))
        else -> previous.copy(last = total)
    }
    return StepReading(base, base.carried + (total - base.start))
}

/** Stored form of a baseline (platform preferences hold a string). */
fun encodeStepBaseline(baseline: StepBaseline): String = AppJson.encodeToString(StepBaseline.serializer(), baseline)

/** A stored baseline, or null when absent or unreadable (counting then restarts for today). */
fun decodeStepBaseline(raw: String?): StepBaseline? =
    raw?.let { runCatching { AppJson.decodeFromString(StepBaseline.serializer(), it) }.getOrNull() }
