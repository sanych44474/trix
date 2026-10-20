package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_dock_draft_local
import app.hacklimits.shared.resources.wk_dock_draft_offline
import app.hacklimits.shared.resources.wk_dock_draft_synced
import app.hacklimits.shared.resources.wk_dock_not_started
import app.hacklimits.shared.resources.wk_dock_saved_at
import app.hacklimits.shared.resources.wk_dock_saved_offline
import app.hacklimits.shared.resources.wk_finish_workout_btn
import app.hacklimits.shared.resources.wk_saved_btn
import app.hacklimits.shared.resources.wk_saving_ellipsis
import app.hacklimits.shared.resources.wk_save_changes_btn
import app.hacklimits.shared.resources.wk_save_for_date
import app.hacklimits.shared.resources.wk_train_resting_label
import app.hacklimits.shared.resources.wk_train_rest_next_btn
import app.hacklimits.shared.resources.wk_train_rest_over_label
import app.hacklimits.shared.workout.DockAction
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.RestUi
import app.hacklimits.shared.workout.SyncState
import app.hacklimits.shared.workout.logic.REST_ADJUST_SEC
import app.hacklimits.shared.workout.logic.fmtDuration
import app.hacklimits.shared.workout.logic.fmtRest
import app.hacklimits.shared.workout.logic.isExerciseFilled
import app.hacklimits.shared.workout.logic.restRingPct
import app.hacklimits.shared.workout.logic.sessionElapsedSec
import kotlinx.coroutines.delay
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.compose.resources.stringResource
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

/** The rest countdown pinned above the save dock: time left, −15 / +15, and "Next" to stop it. */
@Composable
fun RestBar(vm: LoggerViewModel, rest: RestUi) {
    val over = rest.done
    val time = if (over) "+${fmtRest(rest.over)}" else fmtRest(rest.left)
    val label = when {
        over -> stringResource(Res.string.wk_train_rest_over_label)
        rest.label.isNotBlank() -> rest.label
        else -> stringResource(Res.string.wk_train_resting_label)
    }
    Surface(Modifier.fillMaxWidth(), tonalElevation = 3.dp) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                Text(time, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.adjustRest(-REST_ADJUST_SEC) }) {
                    Text("−$REST_ADJUST_SEC", modifier = Modifier.padding(horizontal = 4.dp))
                }
                OutlinedButton(onClick = { vm.adjustRest(REST_ADJUST_SEC) }) {
                    Text("+$REST_ADJUST_SEC", modifier = Modifier.padding(horizontal = 4.dp))
                }
                Button(onClick = { vm.stopRest() }) { Text(stringResource(Res.string.wk_train_rest_next_btn)) }
            }
            val fraction = (100 - restRingPct(rest.target, rest.left)) / 100f
            LinearProgressIndicator(progress = { fraction.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * Pinned to the bottom of the logger: the session clock, the save state and the one action that
 * matters. The save button is not at the end of a long list, where a success would look like nothing.
 */
@OptIn(ExperimentalTime::class)
@Composable
fun SaveDock(vm: LoggerViewModel, s: LoggerUi, restBar: @Composable () -> Unit) {
    val action = s.dockAction
    val clock = if (s.logDate == null) s.clock else null
    val running = clock != null && clock.endedAt == null
    var now by remember { mutableStateOf(Clock.System.now().toEpochMilliseconds()) }
    LaunchedEffect(running) {
        while (running) {
            now = Clock.System.now().toEpochMilliseconds()
            delay(1_000)
        }
    }
    val filled = s.exercises.count(::isExerciseFilled)
    val elapsed = sessionElapsedSec(clock, if (running) now else Clock.System.now().toEpochMilliseconds())
    val status = when {
        s.saving -> stringResource(Res.string.wk_saving_ellipsis)
        action == DockAction.Saved && s.queued -> stringResource(Res.string.wk_dock_saved_offline)
        action == DockAction.Saved && s.savedAtMs != null -> stringResource(Res.string.wk_dock_saved_at, clockTime(s.savedAtMs))
        s.drafted -> when (s.sync) {
            SyncState.SYNCED -> stringResource(Res.string.wk_dock_draft_synced)
            SyncState.OFFLINE -> stringResource(Res.string.wk_dock_draft_offline)
            else -> stringResource(Res.string.wk_dock_draft_local)
        }
        filled == 0 -> stringResource(Res.string.wk_dock_not_started)
        else -> ""
    }
    val label = when {
        s.saving -> stringResource(Res.string.wk_saving_ellipsis)
        action == DockAction.Finish -> stringResource(Res.string.wk_finish_workout_btn)
        action == DockAction.Update -> stringResource(Res.string.wk_save_changes_btn)
        action is DockAction.Backfill -> stringResource(Res.string.wk_save_for_date, action.date)
        else -> stringResource(Res.string.wk_saved_btn)
    }
    val disabled = filled == 0 || s.saving || action == DockAction.Saved

    Column(Modifier.fillMaxWidth()) {
        restBar()
        Surface(Modifier.fillMaxWidth(), tonalElevation = 6.dp) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    if (elapsed > 0) Text("⏱ ${fmtDuration(elapsed)}", fontWeight = FontWeight.Bold)
                    if (status.isNotEmpty()) {
                        Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Button(onClick = { vm.pressSave() }, enabled = !disabled) { Text(label) }
            }
        }
    }
}

private fun clockTime(epochMs: Long): String {
    val time = Instant.fromEpochMilliseconds(epochMs).toLocalDateTime(TimeZone.currentSystemDefault())
    return "${time.hour}:${time.minute.toString().padStart(2, '0')}"
}
