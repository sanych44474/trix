package app.hacklimits.shared.trainer.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.datetime.LocalDate
import org.jetbrains.compose.resources.stringResource

/** A surface card with the padding and gap every trainer panel uses. */
@Composable
internal fun TrainerPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
internal fun PanelHead(eyebrow: String, title: String, count: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(eyebrow, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        if (count != null) Text(count, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
internal fun MutedText(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
internal fun AttentionText(text: String) = Text(text, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)

/** A failed action: one dismissible line, the panel behind it stays as it was. */
@Composable
internal fun ActionErrorNote(onDismiss: () -> Unit) {
    TrainerPanel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.tr_generic_error), color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text(stringResource(Res.string.tr_close)) }
        }
    }
}

/** A failed list load: nothing to show, so the whole area offers a retry. */
@Composable
internal fun LoadErrorPanel(onRetry: () -> Unit) {
    TrainerPanel {
        Text(stringResource(Res.string.tr_load_error), fontWeight = FontWeight.SemiBold)
        Button(onClick = onRetry) { Text(stringResource(Res.string.tr_retry_label)) }
    }
}

/** A short inline confirmation (saved, sent, created) under the panel that produced it. */
@Composable
internal fun NoticeText(text: String) = Text(text, color = MaterialTheme.colorScheme.primary)

/** Date for the card: day.month from the ISO date, same for every locale (no month names in code). */
internal fun shortDate(iso: String): String = runCatching {
    val date = LocalDate.parse(iso.take(10))
    "${date.day}.${(date.month.ordinal + 1).toString().padStart(2, '0')}"
}.getOrDefault(iso)
