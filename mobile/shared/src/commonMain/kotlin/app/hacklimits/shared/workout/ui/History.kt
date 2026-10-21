package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_generic_error
import app.hacklimits.shared.resources.wk_history_empty_detail
import app.hacklimits.shared.resources.wk_history_empty_title
import app.hacklimits.shared.resources.wk_history_eyebrow
import app.hacklimits.shared.resources.wk_history_row_exercises
import app.hacklimits.shared.resources.wk_history_title
import app.hacklimits.shared.resources.wk_log_missed_btn
import app.hacklimits.shared.resources.wk_log_missed_detail
import app.hacklimits.shared.resources.wk_log_missed_eyebrow
import app.hacklimits.shared.resources.wk_log_missed_title
import app.hacklimits.shared.resources.wk_pick_date_label
import app.hacklimits.shared.resources.wk_repeat_btn
import app.hacklimits.shared.resources.wk_retry
import app.hacklimits.shared.resources.wk_saving_ellipsis
import app.hacklimits.shared.resources.wk_start_blank_btn
import app.hacklimits.shared.resources.wk_train_edit_saved_btn
import app.hacklimits.shared.resources.wk_use_these_exercises_btn
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.logic.fmtDuration
import app.hacklimits.shared.workout.logic.isoDateMinus
import org.jetbrains.compose.resources.stringResource

private val ISO_DATE = Regex("\\d{4}-\\d{2}-\\d{2}")

/** Past sessions to repeat or fix, and a missed day to log from scratch or from another day. */
@Composable
fun HistoryView(vm: LoggerViewModel, s: LoggerUi, todayDate: String) {
    val minMissed = isoDateMinus(todayDate, 14)
    val history = s.history
    val busy = s.historyBusy
    // Scrolls: without it only the sessions that fit on one screen were reachable, and the last
    // card was cut off at the bottom edge.
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(Res.string.wk_history_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.wk_history_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            s.historyError != null -> Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(Res.string.wk_generic_error), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { vm.loadHistory() }) { Text(stringResource(Res.string.wk_retry)) }
                }
            }
            history == null -> CircularProgressIndicator()
            history.isEmpty() -> Column {
                Text(stringResource(Res.string.wk_history_empty_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(Res.string.wk_history_empty_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> history.forEach { item ->
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(item.date, Modifier.weight(1f), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            Text(
                                stringResource(Res.string.wk_history_row_exercises, item.n) +
                                    (item.durationSec?.takeIf { it > 0 }?.let { " · ${fmtDuration(it)}" } ?: ""),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                        Text(item.title, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        // Two equal buttons on one line; the longer "log a missed day" gets a line of its
                        // own (squeezed into the same row it broke letter by letter).
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Button(onClick = { vm.repeatDay(item.date) }, enabled = busy == null, modifier = Modifier.weight(1f)) {
                                Text(
                                    if (busy == "repeat:${item.date}") stringResource(Res.string.wk_saving_ellipsis) else stringResource(Res.string.wk_repeat_btn),
                                    maxLines = 1,
                                )
                            }
                            OutlinedButton(onClick = { vm.editSavedDay(item.date) }, enabled = busy == null, modifier = Modifier.weight(1f)) {
                                Text(
                                    if (busy == "fill:${item.date}") stringResource(Res.string.wk_saving_ellipsis) else stringResource(Res.string.wk_train_edit_saved_btn),
                                    maxLines = 1,
                                )
                            }
                        }
                        if (item.date >= minMissed && item.date < todayDate) {
                            TextButton(onClick = { vm.setMissedDate(item.date) }, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(Res.string.wk_log_missed_btn))
                            }
                        }
                    }
                }
            }
        }
        MissedDayCard(vm, s, todayDate, minMissed)
    }
}

@Composable
private fun MissedDayCard(vm: LoggerViewModel, s: LoggerUi, todayDate: String, minMissed: String) {
    val busy = s.historyBusy
    val date = s.missedDate
    val valid = ISO_DATE.matches(date) && date >= minMissed && date <= todayDate
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.wk_log_missed_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(Res.string.wk_log_missed_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(stringResource(Res.string.wk_log_missed_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = date,
                onValueChange = { vm.setMissedDate(it.take(10)) },
                label = { Text(stringResource(Res.string.wk_pick_date_label)) },
                placeholder = { Text("YYYY-MM-DD") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (valid) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.startBlankDay(date) }, enabled = busy == null) {
                        Text(if (busy == "blank:$date") stringResource(Res.string.wk_saving_ellipsis) else stringResource(Res.string.wk_start_blank_btn))
                    }
                }
                s.history.orEmpty().filter { it.date != date }.take(3).forEach { item ->
                    OutlinedButton(onClick = { vm.fillFromPast(date, item.date) }, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                        Text(
                            if (busy == "fill:${item.date}") stringResource(Res.string.wk_saving_ellipsis)
                            else "${stringResource(Res.string.wk_use_these_exercises_btn)} (${item.date})",
                        )
                    }
                }
            }
        }
    }
}
