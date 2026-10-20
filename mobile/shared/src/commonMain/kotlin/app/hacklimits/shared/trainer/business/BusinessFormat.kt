package app.hacklimits.shared.trainer.business

import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime

/** Whole amounts print without a decimal point; anything else is printed exactly as the server sent it. */
fun formatAmount(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/** The server's currency code, or no code at all when the server sent none. Never a guessed one. */
fun formatMoney(value: Double, currency: String): String =
    listOf(formatAmount(value), currency).filter { it.isNotBlank() }.joinToString(" ")

/** "2026-10-20 18:00" in the device time zone to the ISO instant the server expects. Null when unreadable. */
fun parseLocalStart(input: String): String? = runCatching {
    LocalDateTime.parse(input.trim().replace(' ', 'T')).toInstant(TimeZone.currentSystemDefault()).toString()
}.getOrNull()

/** The server's ISO instant back to "2026-10-20 18:00" in the device time zone. */
fun formatLocalStart(iso: String): String = runCatching {
    val t = Instant.parse(iso).toLocalDateTime(TimeZone.currentSystemDefault())
    "${t.date} ${t.hour.pad()}:${t.minute.pad()}"
}.getOrDefault(iso)

private fun Int.pad() = toString().padStart(2, '0')
