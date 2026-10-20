package app.hacklimits.shared.settings

import kotlinx.datetime.LocalDate

/** A "YYYY-MM-DD" date typed by the person, or null. */
fun parseIsoDate(text: String): LocalDate? {
    if (!Regex("""\d{4}-\d{2}-\d{2}""").matches(text)) return null
    return runCatching { LocalDate.parse(text) }.getOrNull()
}

/** Vacation length for a chosen end date: whole days from [today], kept within the server's 1..90. */
fun vacationDaysUntil(today: LocalDate, until: LocalDate): Int =
    (until.toEpochDays() - today.toEpochDays()).coerceIn(1L, 90L).toInt()
