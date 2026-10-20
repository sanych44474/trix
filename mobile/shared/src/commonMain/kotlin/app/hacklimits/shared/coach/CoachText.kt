package app.hacklimits.shared.coach

/**
 * The coach's text is shown in a plain Compose Text, which would print tags and entities
 * literally. The solo answer is plain text today, but trainer drafts were HTML-escaped for
 * Telegram, so strip tags and decode entities here. &amp; goes last so "&amp;lt;" stays literal.
 */
internal fun plainCoachText(raw: String): String =
    raw.replace(BR, "\n")
        .replace(TAG, "")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .trim()

private val BR = Regex("<br\\s*/?>", RegexOption.IGNORE_CASE)
private val TAG = Regex("<[^>]*>")
