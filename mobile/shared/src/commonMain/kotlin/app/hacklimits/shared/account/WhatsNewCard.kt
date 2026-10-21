package app.hacklimits.shared.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource

/** The latest release note as a card, for Today. It shows the headlines first, the details on request,
 * and hides itself once the person taps "Got it"; [onGotIt] then records it on the server (WhatsNewApi.markSeen). */
@Composable
fun WhatsNewCard(note: WhatsNewNote, onGotIt: suspend (version: String) -> Unit, modifier: Modifier = Modifier) {
    var hidden by remember(note.version) { mutableStateOf(false) }
    var open by remember(note.version) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val items = remember(note.version, note.text, note.html) { releaseItems(note) }
    if (hidden) return

    Card(modifier = modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(Res.string.ex_whatsnew_eyebrow) + " · " + note.version,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(stringResource(Res.string.ex_whatsnew_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            ReleaseItems(items, compact = !open)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    hidden = true
                    scope.launch { runCatching { onGotIt(note.version) } }
                }) { Text(stringResource(Res.string.ex_whatsnew_got_it)) }
                if (!open) TextButton(onClick = { open = true }) { Text(stringResource(Res.string.ex_whatsnew_more)) }
            }
        }
    }
}

/** The release as cards. Compact shows only titles, except for paragraphs that have no title. */
@Composable
fun ReleaseItems(items: List<ReleaseItem>, compact: Boolean = false, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.icon.isNotEmpty()) Text(item.icon)
                Column(Modifier.fillMaxWidth()) {
                    if (item.title.isNotEmpty()) Text(item.title, fontWeight = FontWeight.SemiBold)
                    if (!compact || item.title.isEmpty()) Text(item.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** Items for a note: the plain text when the server sent it, else the stripped HTML. */
fun releaseItems(note: WhatsNewNote): List<ReleaseItem> =
    parseReleaseNote(note.text ?: plainReleaseText(note.html))
