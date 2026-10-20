package app.hacklimits.shared.account

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** GET /api/v2/whatsnew: the latest release, in the account's language. [text] is plain text
 * (paragraphs of "emoji *Title* — body"); [html] is the Telegram version. */
@Serializable
data class WhatsNewNote(val version: String, val html: String = "", val text: String? = null)

class WhatsNewApi(private val api: ApiClient) {
    suspend fun latest(): WhatsNewNote = api.unwrap(api.http.get("api/v2/whatsnew") { api.authorize(this) })

    /** The person dismissed the card; the server remembers it so it does not come back on any device. */
    suspend fun markSeen(version: String) {
        api.unwrap<JsonObject>(api.http.post("api/v2/whatsnew/seen") {
            api.authorize(this)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("version", version) })
        })
    }
}

data class ReleaseItem(val icon: String, val title: String, val body: String)

private val GREETING_SKIP = Regex("""(Menu|Меню)\s*→""")
private val CLOSING_LINE = Regex("""^(Tap|Тисни)\s""")
private val ITEM_SHAPE = Regex("""^(\S+)\s+\*([^*]+)\*\s*[—–-]?\s*([\s\S]*)$""")
private val BOLD = Regex("""\*([^*]+)\*""")
private val ITALIC = Regex("""_([^_]+)_""")
private val BLANK_LINE = Regex("""\n\s*\n""")

/** A release note as cards: one per paragraph shaped "emoji *Title* — text". The greeting (first
 * paragraph) and the bot-only closing line are dropped; a paragraph without that shape keeps its text
 * as the body. Port of apps/mini-app and src/domain/releaseDelivery.ts parseReleaseNote. */
fun parseReleaseNote(text: String): List<ReleaseItem> =
    text.split(BLANK_LINE)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .drop(1)
        .filterNot { GREETING_SKIP.containsMatchIn(it) || CLOSING_LINE.containsMatchIn(it) }
        .map { p ->
            val m = ITEM_SHAPE.find(p)
            if (m != null) {
                ReleaseItem(
                    icon = m.groupValues[1],
                    title = stripMarkup(m.groupValues[2]),
                    body = capitalize(stripMarkup(m.groupValues[3])),
                )
            } else {
                ReleaseItem("", "", stripMarkup(p))
            }
        }

/** Plain text from the Telegram HTML version, for a client that has no plain text. */
fun plainReleaseText(html: String): String =
    html.replace(Regex("<[^>]+>"), " ").replace("&nbsp;", " ").replace("&amp;", "&")

private fun stripMarkup(s: String): String =
    s.replace(BOLD, "$1").replace(ITALIC, "$1").trim()

private fun capitalize(s: String): String = s.replaceFirstChar { it.uppercaseChar() }
