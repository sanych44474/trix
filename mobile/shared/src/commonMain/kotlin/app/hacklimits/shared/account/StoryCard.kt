package app.hacklimits.shared.account

/** The content of a share card (Telegram story in the Mini App). Native has no canvas, so the card is
 * shared as text through the platform share sheet; drawing it as an image needs a platform renderer. */
data class StoryCardContent(
    /** Small line on top, e.g. the date range. */
    val eyebrow: String,
    /** Big headline, e.g. "My training week". */
    val title: String,
    val rows: List<Pair<String, String>>,
    /** Call to action at the bottom. */
    val footer: String,
) {
    fun shareText(): String = buildString {
        appendLine(title)
        if (eyebrow.isNotBlank()) appendLine(eyebrow)
        rows.forEach { (label, value) -> appendLine("$label: $value") }
        append(footer)
    }
}
