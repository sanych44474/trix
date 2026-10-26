package app.hacklimits.shared.workout.logic

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

// Port of apps/mini-app/src/logic/loggerOrder.ts: reordering a session and resuming a rest. Tested
// against the golden cases generated from the TS module (test/fixtures/logger-order.json, embedded in
// LoggerOrderFixturesGenerated.kt), so the two apps can't drift apart.

/** A list change: [order] lists the old positions in their new order; [focus] is where the focused
 *  exercise ends up (null when nothing is focused or nothing is left). */
data class Reordered(val order: List<Int>, val focus: Int?)

/** Swaps the exercise at [at] with its neighbour; focus follows the exercise that was on screen.
 *  Null at the edge: nothing changes. */
fun moveInList(length: Int, at: Int, direction: Int, focus: Int?): Reordered? {
    val to = at + direction
    if (at < 0 || at >= length || to < 0 || to >= length) return null
    val order = MutableList(length) { it }
    order[at] = to
    order[to] = at
    val next = when (focus) {
        at -> to
        to -> at
        else -> focus
    }
    return Reordered(order, next)
}

/** Removes the exercise at [at]. A focused exercise further down shifts up with the list; when the
 *  focused one itself goes, its neighbour takes the screen (the next one, or the previous at the end). */
fun removeFromList(length: Int, at: Int, focus: Int?): Reordered {
    if (at < 0 || at >= length) return Reordered(List(length) { it }, focus)
    val order = (0 until length).filter { it != at }
    if (focus == null || order.isEmpty()) return Reordered(order, if (order.isEmpty()) null else focus)
    val next = if (focus > at) focus - 1 else minOf(focus, order.size - 1)
    return Reordered(order, next)
}

/** Only a set finished just now starts the rest; correcting a set already done leaves the running one alone. */
fun startsRest(autoRest: Boolean, wasDone: Boolean): Boolean = autoRest && !wasDone

/** The rest that was counting down when the app closed, as kept on the device (same keys as the Mini App). */
@Serializable
data class RunningRest(val endAt: Long, val startedAt: Long, val target: Int, val label: String)

/** The saved rest, if it is still worth showing: well-formed and not past the overrun cap. */
fun resumableRest(saved: JsonElement?, nowMs: Long, defaultTarget: Int): RunningRest? {
    val obj = saved as? JsonObject ?: return null
    fun number(key: String): JsonPrimitive? = (obj[key] as? JsonPrimitive)?.takeIf { !it.isString }
    val endAt = number("endAt")?.longOrNull ?: return null
    val startedAt = number("startedAt")?.longOrNull ?: return null
    if (startedAt > endAt) return null
    if (restProgress(endAt, nowMs).over >= REST_OVERRUN_CAP_SEC) return null
    val target = number("target")?.doubleOrNull?.takeIf { it > 0 }?.toInt() ?: defaultTarget
    val label = (obj["label"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
    return RunningRest(endAt, startedAt, target, label)
}
