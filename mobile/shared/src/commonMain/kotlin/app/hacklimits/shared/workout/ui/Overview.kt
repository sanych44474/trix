package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_back_to_today
import app.hacklimits.shared.resources.wk_cancel_btn
import app.hacklimits.shared.resources.wk_close
import app.hacklimits.shared.resources.wk_generic_error
import app.hacklimits.shared.resources.wk_logging_for_date_note
import app.hacklimits.shared.resources.wk_repeated_note
import app.hacklimits.shared.resources.wk_restored_other_device_note
import app.hacklimits.shared.resources.wk_session_saved
import app.hacklimits.shared.resources.wk_session_saved_for_date
import app.hacklimits.shared.resources.wk_start_session
import app.hacklimits.shared.resources.wk_swap_plan_saved
import app.hacklimits.shared.resources.wk_today_continue_btn
import app.hacklimits.shared.resources.wk_today_done_title
import app.hacklimits.shared.resources.wk_train_add_custom_btn
import app.hacklimits.shared.resources.wk_train_add_exercise_btn
import app.hacklimits.shared.resources.wk_train_as_planned_all_btn
import app.hacklimits.shared.resources.wk_train_custom_ph
import app.hacklimits.shared.resources.wk_train_progress_line
import app.hacklimits.shared.resources.wk_training_session_title
import app.hacklimits.shared.resources.offline_pending
import app.hacklimits.shared.resources.offline_attention
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.isExerciseFilled
import app.hacklimits.shared.workout.logic.isSetFilled
import org.jetbrains.compose.resources.stringResource
import kotlin.math.max

/** Notes above the session: a plan change saved, an error to dismiss, and which day or copy is open. */
@Composable
fun LoggerNotes(vm: LoggerViewModel, s: LoggerUi) {
    if (s.pendingSyncCount > 0 || s.needsAttentionCount > 0) {
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (s.pendingSyncCount > 0) Text(stringResource(Res.string.offline_pending, s.pendingSyncCount))
                if (s.needsAttentionCount > 0) Text(stringResource(Res.string.offline_attention, s.needsAttentionCount), color = MaterialTheme.colorScheme.error)
            }
        }
    }
    s.planNoticeName?.let { name ->
        Card(Modifier.fillMaxWidth().clickable { vm.dismissPlanNotice() }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
            Text(stringResource(Res.string.wk_swap_plan_saved, name), Modifier.padding(12.dp))
        }
    }
    if (s.actionError != null) {
        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(Res.string.wk_generic_error), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { vm.dismissActionError() }) { Text(stringResource(Res.string.wk_close)) }
            }
        }
    }
    if (s.restoredFromServer && s.drafted) {
        Text(stringResource(Res.string.wk_restored_other_device_note), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    val logDate = s.logDate
    if (logDate != null && !s.saved) {
        Text(stringResource(Res.string.wk_logging_for_date_note, logDate), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    val copiedFrom = s.copiedFrom
    if (copiedFrom != null && logDate == null && !s.saved) {
        Text(stringResource(Res.string.wk_repeated_note, copiedFrom), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The list of today's exercises, with the start / continue button and adding one of the person's own. */
@Composable
fun OverviewView(vm: LoggerViewModel, s: LoggerUi, title: String, onStart: (Int) -> Unit) {
    val exercises = s.exercises
    val filled = exercises.count(::isExerciseFilled)
    val currentIndex = exercises.firstOrNull { !complete(it) }?.index ?: exercises.last().index
    val scroll = rememberScrollState()
    Column(
        Modifier.fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title.ifBlank { stringResource(Res.string.wk_training_session_title) }, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(stringResource(Res.string.wk_train_progress_line, filled, exercises.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LoggerNotes(vm, s)
        if (s.logDate != null || s.copiedFrom != null) {
            TextButton(onClick = { vm.backToToday() }) { Text(stringResource(Res.string.wk_back_to_today)) }
        }
        val summary = s.summary
        if (summary != null) {
            SummaryView(vm, s, summary, title = if (s.summaryDate != null) stringResource(Res.string.wk_session_saved_for_date, s.summaryDate) else stringResource(Res.string.wk_session_saved), subtitle = title, onAskCoach = null, asScreen = false)
        } else if (s.saved && s.dayLogged) {
            Text(
                if (s.summaryDate != null) stringResource(Res.string.wk_session_saved_for_date, s.summaryDate) else stringResource(Res.string.wk_session_saved),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        if (!s.saved) {
            Button(onClick = { onStart(currentIndex) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (filled > 0) Res.string.wk_today_continue_btn else Res.string.wk_start_session))
            }
        }
        if (s.logDate != null && exercises.size > 1 && filled == 0) {
            OutlinedButton(onClick = { vm.fillPlannedAll() }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(Res.string.wk_train_as_planned_all_btn))
            }
        }
        exercises.forEach { ex -> ExerciseRow(ex, onOpen = { onStart(ex.index) }) }
        CustomExerciseBox(vm, s)
        PlatesCard(vm, s)
    }
}

@Composable
private fun ExerciseRow(ex: LoggerExercise, onOpen: () -> Unit) {
    val done = ex.done.count(::isSetFilled)
    val shown = max(ex.sets, ex.done.size)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (complete(ex)) "✓" else "${ex.index + 1}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f)) {
            Text(ex.name, fontWeight = FontWeight.SemiBold)
            Text(
                when {
                    done > 0 -> "$done/$shown"
                    ex.planSets != null -> ex.planSets
                    else -> "${ex.sets} ×"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("›", style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun CustomExerciseBox(vm: LoggerViewModel, s: LoggerUi) {
    if (!s.customOpen) {
        OutlinedButton(onClick = { vm.setCustomOpen(true) }, modifier = Modifier.fillMaxWidth()) {
            Text("+ " + stringResource(Res.string.wk_train_add_exercise_btn).replace(Regex("^\\+\\s*"), ""))
        }
        return
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = s.customName,
                onValueChange = { vm.setCustomName(it.take(80)) },
                placeholder = { Text(stringResource(Res.string.wk_train_custom_ph)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { vm.addCustom() }, enabled = s.busy != "custom") {
                    Text(stringResource(Res.string.wk_train_add_custom_btn))
                }
                TextButton(onClick = { vm.setCustomOpen(false) }) { Text(stringResource(Res.string.wk_cancel_btn)) }
            }
        }
    }
}

@Composable
private fun PlatesCard(vm: LoggerViewModel, s: LoggerUi) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(12.dp)) {
            PlatesCalculator(vm, s)
        }
    }
}

private fun complete(ex: LoggerExercise): Boolean = ex.done.count(::isSetFilled) >= max(1, ex.sets)
