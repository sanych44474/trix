package app.hacklimits.shared.inbox

import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** Where a row leads. The host maps these to its own routes (the Mini App: plan, progress, role, today, more). */
enum class InboxTarget { Plan, Progress, Role, Today, More }

/** Which sentence a row shows; the screen resolves it to a string resource. */
enum class InboxCopy { PLAN_ASSIGNED, PLAN_CHANGED, MESSAGE, BADGE, PROGRESSION, FEEDBACK_DONE, SQUAD_PR, SQUAD_WEEK, SQUAD_WEEK_PAST }

/** Placeholder for an unnamed squad; the screen swaps in the localized default. */
object DefaultSquadName

data class InboxLine(val copy: InboxCopy, val args: List<Any> = emptyList())

/**
 * The sentence for an item, as the Mini App's inboxText builds it. Null for a kind this build
 * does not know, so it is left out rather than shown blank. [uk] picks the badge's name.
 */
internal fun inboxLine(item: InboxItem, uk: Boolean): InboxLine? {
    val p = item.params
    return when (item.kind) {
        "plan_assigned" -> InboxLine(InboxCopy.PLAN_ASSIGNED)
        "plan_changed" -> InboxLine(InboxCopy.PLAN_CHANGED)
        "message" -> InboxLine(InboxCopy.MESSAGE, listOf(p.str("fromName").ifEmpty { "—" }, p.str("preview")))
        "badge" -> InboxLine(InboxCopy.BADGE, listOf(p.strOrNull(if (uk) "uk" else "en") ?: p.str("code")))
        "progression" -> InboxLine(InboxCopy.PROGRESSION, listOf(p.int("n")))
        "feedback_done" -> InboxLine(InboxCopy.FEEDBACK_DONE, listOf(p.str("preview")))
        "squad_pr" -> InboxLine(InboxCopy.SQUAD_PR, listOf(p.str("name"), p.str("exercise"), p.str("best")))
        "squad_week" -> {
            val copy = if (p["past"]?.let { (it as? JsonPrimitive)?.booleanOrNull } == true) InboxCopy.SQUAD_WEEK_PAST else InboxCopy.SQUAD_WEEK
            val title: Any = p.str("title").ifEmpty { DefaultSquadName }
            InboxLine(copy, listOf(title, squadTop(p), p.int("total")))
        }
        else -> null
    }
}

/** The row's destination, as the Mini App's TARGET table. */
internal fun inboxTarget(kind: String): InboxTarget? = when (kind) {
    "plan_assigned", "plan_changed", "progression" -> InboxTarget.Plan
    "message" -> InboxTarget.Role
    "badge" -> InboxTarget.Progress
    "feedback_done" -> InboxTarget.Today
    "squad_pr", "squad_week" -> InboxTarget.More
    else -> null
}

/** Top entries of a squad week, "🥇 Ann 3 · 🥈 Bo 2", as the Mini App lists them. */
private fun squadTop(p: JsonObject): String {
    val rows = p["top"] as? JsonArray ?: return ""
    return rows.joinToString(" · ") { row ->
        val o = row.jsonObject
        "${o.str("medal")} ${o.str("name")} ${o.int("workouts")}".trim()
    }
}

/** A "when" label: the clock for today, "yesterday", or day.month otherwise (same 24 h buckets as the Mini App). */
sealed interface InboxWhen {
    data class Clock(val hhmm: String) : InboxWhen
    data object Yesterday : InboxWhen
    data class Day(val ddmm: String) : InboxWhen
}

internal fun inboxWhen(createdAt: String, now: Instant, zone: TimeZone): InboxWhen? {
    val at = parseInstant(createdAt, zone) ?: return null
    val days = (now - at).inWholeDays
    val local = at.toLocalDateTime(zone)
    return when {
        days <= 0 -> InboxWhen.Clock("${local.hour.pad()}:${local.minute.pad()}")
        days == 1L -> InboxWhen.Yesterday
        else -> InboxWhen.Day("${local.dayOfMonth.pad()}.${local.monthNumber.pad()}")
    }
}

/** Server timestamps are ISO (with Z) or SQL style; SQL is read in the device's zone, as the browser does. */
private fun parseInstant(raw: String, zone: TimeZone): Instant? =
    runCatching { Instant.parse(raw) }.getOrNull()
        ?: runCatching { LocalDateTime.parse(raw.trim().replace(' ', 'T')).toInstant(zone) }.getOrNull()

private fun Int.pad(): String = toString().padStart(2, '0')

private fun JsonObject.str(key: String): String = strOrNull(key) ?: ""

private fun JsonObject.strOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0
