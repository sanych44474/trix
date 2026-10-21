package app.hacklimits.shared.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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

/** Imports workout history from a Strong or Hevy CSV export. Days already logged are never overwritten. */
@Composable
fun ImportCsvScreen(onBack: () -> Unit) {
    val vm: ImportCsvViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) } }
        item { Text(stringResource(Res.string.md_import_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        item { MediaPanel { Text(stringResource(Res.string.md_import_detail), color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        item {
            MediaPanel {
                Button(onClick = vm::pickCsv, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(if (s.busy) Res.string.md_saving else Res.string.md_import_btn))
                }
                if (s.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
        s.done?.let { done ->
            item {
                Text(
                    stringResource(
                        if (done.capped) Res.string.md_import_done_capped else Res.string.md_import_done,
                        done.imported, done.skipped, done.cap,
                    ),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
        s.note?.let { note ->
            item {
                Text(
                    noteText(note),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

@Composable
private fun noteText(note: String): String = when (note) {
    "too_big" -> stringResource(Res.string.md_import_too_big)
    "wrong_format" -> stringResource(Res.string.md_import_wrong_format)
    "failed" -> stringResource(Res.string.md_import_failed)
    else -> stringResource(Res.string.err_generic)
}
