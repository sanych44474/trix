package app.hacklimits.shared.owner

import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

internal enum class RosterFilter { ALL, ONBOARDING, ACTIVE, IDLE }

internal enum class SeenKind { NEVER, TODAY, YESTERDAY, DAYS, DATE }

/** "Last seen" for the roster: today, yesterday, N days ago, or the date. [days] is set for DAYS. */
internal data class SeenLabel(val kind: SeenKind, val days: Int = 0, val date: String = "")

internal fun seenLabel(iso: String?, now: Instant): SeenLabel {
    if (iso == null) return SeenLabel(SeenKind.NEVER)
    val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return SeenLabel(SeenKind.NEVER)
    val days = (now.toLocalDateTime(TimeZone.UTC).date.toEpochDays() - then.toLocalDateTime(TimeZone.UTC).date.toEpochDays()).toInt()
    return when {
        days <= 0 -> SeenLabel(SeenKind.TODAY)
        days == 1 -> SeenLabel(SeenKind.YESTERDAY)
        days <= 30 -> SeenLabel(SeenKind.DAYS, days = days)
        else -> SeenLabel(SeenKind.DATE, date = iso.take(10))
    }
}

/** Away 7+ days, or never seen. */
internal fun isIdle(user: OwnerUser, now: Instant): Boolean {
    val label = seenLabel(user.lastSeen, now)
    return user.lastSeen == null || label.kind == SeenKind.DATE || label.days > 7
}

/** The roster rows for a filter, most recently seen first; never-seen last. */
internal fun rosterRows(users: List<OwnerUser>, filter: RosterFilter, now: Instant): List<OwnerUser> =
    users
        .filter {
            when (filter) {
                RosterFilter.ALL -> true
                RosterFilter.ONBOARDING -> it.status == "onboarding"
                RosterFilter.ACTIVE -> !isIdle(it, now) && it.status != "onboarding"
                RosterFilter.IDLE -> isIdle(it, now)
            }
        }
        .sortedByDescending { it.lastSeen.orEmpty() }

/** The /ownerreport HTML as plain text: tags dropped, the two entities the reports use decoded. */
internal fun plainReport(html: String): String =
    html.replace(Regex("<[^>]+>"), " ").replace("&nbsp;", " ").replace("&amp;", "&")
