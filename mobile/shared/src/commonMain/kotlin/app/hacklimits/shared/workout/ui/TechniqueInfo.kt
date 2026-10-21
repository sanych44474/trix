package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_saving_ellipsis
import app.hacklimits.shared.resources.wk_technique_frames_exact
import app.hacklimits.shared.resources.wk_technique_frames_similar
import app.hacklimits.shared.resources.wk_train_no_info
import app.hacklimits.shared.resources.wk_train_watch_video
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.logic.ExerciseImages
import app.hacklimits.shared.workout.logic.LoggerExercise
import coil3.compose.AsyncImage
import org.jetbrains.compose.resources.stringResource

/** The info panel under an exercise: its pictures and steps, the technique text and the video. */
@Composable
fun ExerciseInfoPanel(vm: LoggerViewModel, s: LoggerUi, ex: LoggerExercise) {
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TechniqueFrames(vm, ex.name, ex.canonicalName)
        val info = s.info
        if (s.busy == "info:${ex.index}") {
            Text(stringResource(Res.string.wk_saving_ellipsis), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text(info?.technique?.takeIf { it.isNotBlank() } ?: stringResource(Res.string.wk_train_no_info))
        }
        info?.videoUrl?.let { url ->
            TextButton(onClick = { uri.openUri(url) }) {
                Text(info.videoTitle?.takeIf { it.isNotBlank() } ?: stringResource(Res.string.wk_train_watch_video))
            }
        }
    }
}

/**
 * Start and end frames of the exercise (free-exercise-db, Unlicense) with its short steps in the
 * user's language. Nothing shows when the exercise has no picture; a failed picture is hidden and the
 * steps still help.
 */
@Composable
fun TechniqueFrames(vm: LoggerViewModel, name: String, canonicalName: String?) {
    val match = remember(name, canonicalName) { ExerciseImages.match(name, canonicalName) } ?: return
    val urls = remember(match.id) { ExerciseImages.urls(match.id) }
    var failed by remember(match.id) { mutableStateOf(0) }
    var steps by remember(match.id) { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(match.id) { steps = vm.techniqueSteps(match.id) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (failed < urls.size) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                urls.forEachIndexed { i, url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "${match.title} ${i + 1}/${urls.size}",
                        modifier = Modifier.weight(1f).height(160.dp),
                        onError = { failed += 1 },
                    )
                }
            }
            Text(
                stringResource(
                    if (match.exact) Res.string.wk_technique_frames_exact else Res.string.wk_technique_frames_similar,
                    match.title,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        steps.forEachIndexed { i, step ->
            Text("${i + 1}. $step", modifier = Modifier.padding(start = 2.dp))
        }
    }
}
