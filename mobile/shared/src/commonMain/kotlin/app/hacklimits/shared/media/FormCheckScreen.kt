package app.hacklimits.shared.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/**
 * AI technique remarks on a short training clip. [exercise] prefills the caption when opened from an exercise.
 */
@Composable
fun FormCheckScreen(onBack: () -> Unit, exercise: String? = null) {
    val vm: FormCheckViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(exercise) { exercise?.takeIf { it.isNotBlank() }?.let(vm::presetCaption) }

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) } }
        item { Text(stringResource(Res.string.md_form_check_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        item {
            MediaPanel {
                Text(stringResource(Res.string.md_form_check_intro, MAX_VIDEO_SECONDS), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = s.caption,
                    onValueChange = vm::onCaption,
                    label = { Text(stringResource(Res.string.md_form_check_caption_ph)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(onClick = vm::checkClip, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(if (s.busy) Res.string.md_form_check_watching else Res.string.md_form_check_btn))
                }
                if (s.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
        s.answer?.let { answer ->
            item {
                MediaPanel {
                    Text(answer)
                    Text(stringResource(Res.string.md_form_check_disclaimer), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        s.note?.let { note ->
            item {
                Text(
                    formNoteText(note),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

@Composable
private fun formNoteText(note: FormNote): String = when (note.code) {
    "too_big" -> stringResource(Res.string.md_form_check_too_big, MAX_VIDEO_SECONDS)
    "too_long" -> stringResource(Res.string.md_form_check_too_long, MAX_VIDEO_SECONDS)
    "limit" -> stringResource(Res.string.md_form_check_limit, note.limit ?: 5)
    "failed" -> stringResource(Res.string.md_form_check_failed)
    else -> stringResource(Res.string.err_generic)
}

/** A card panel shared by the media screens. */
@Composable
internal fun MediaPanel(content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}
