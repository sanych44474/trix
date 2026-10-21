package app.hacklimits.shared.daily

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.dl_checklist_hint
import app.hacklimits.shared.resources.dl_checklist_open
import app.hacklimits.shared.resources.dl_checklist_title
import app.hacklimits.shared.resources.dl_diff_easier
import app.hacklimits.shared.resources.dl_diff_harder
import app.hacklimits.shared.resources.dl_diff_none
import app.hacklimits.shared.resources.dl_diff_swapped
import app.hacklimits.shared.resources.dl_energy
import app.hacklimits.shared.resources.dl_error
import app.hacklimits.shared.resources.dl_reminder_eyebrow
import app.hacklimits.shared.resources.dl_reminder_hint
import app.hacklimits.shared.resources.dl_reminder_title
import app.hacklimits.shared.resources.dl_saving
import app.hacklimits.shared.resources.dl_sleep
import app.hacklimits.shared.resources.dl_stress
import app.hacklimits.shared.resources.dl_wellbeing_count
import app.hacklimits.shared.resources.dl_wellbeing_eyebrow
import app.hacklimits.shared.resources.dl_wellbeing_none
import app.hacklimits.shared.resources.dl_wellbeing_title
import app.hacklimits.shared.resources.dl_wellbeing_trend_note
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.abs

// The four daily-habit cards. Each reads the shared DailyViewModel (see DailyModule.kt); the host
// embeds them where they belong (see WIRING NEEDED in the slice report).

/**
 * The 90-day wellbeing averages and trend, the bot's /well numbers. [refreshKey] re-reads them when
 * it changes (e.g. after a check-in). Renders nothing while loading or when the read failed.
 */
@Composable
fun WellbeingCard(refreshKey: Any = Unit, modifier: Modifier = Modifier) {
    val vm: DailyViewModel = koinViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(refreshKey) { vm.loadWellbeing() }
    val wellbeing = state.wellbeing
    if (state.wellbeingError || wellbeing == null) return

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.dl_wellbeing_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(Res.string.dl_wellbeing_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val averages = wellbeing.averages
            val trend = wellbeing.trend
            if (averages == null || trend == null) {
                Text(stringResource(Res.string.dl_wellbeing_none), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(stringResource(Res.string.dl_wellbeing_count, wellbeing.count), color = MaterialTheme.colorScheme.onSurfaceVariant)
                val rows = listOf(
                    Triple(Res.string.dl_energy, averages.energy, trend.energy),
                    Triple(Res.string.dl_sleep, averages.sleep, trend.sleep),
                    Triple(Res.string.dl_stress, averages.stress, trend.stress),
                )
                val metricKeys = listOf("energy", "sleep", "stress")
                rows.forEachIndexed { i, (label, average, change) ->
                    val good = isGoodTrend(metricKeys[i], change)
                    val tone = when {
                        trendArrow(change) == "—" -> MaterialTheme.colorScheme.onSurface
                        good -> MaterialTheme.colorScheme.primary
                        else -> MaterialTheme.colorScheme.error
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(stringResource(label))
                        Text("${oneDecimal(average)}/5 ${trendArrow(change)} ${oneDecimal(abs(change))}", fontWeight = FontWeight.SemiBold, color = tone)
                    }
                }
                Text(stringResource(Res.string.dl_wellbeing_trend_note), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * The daily reminder hour as a stepper that saves each change. [initialHour] is the profile's
 * current reminderHour (default 18, as the bot).
 */
@Composable
fun ReminderHourSetting(initialHour: Int = 18, modifier: Modifier = Modifier) {
    val vm: DailyViewModel = koinViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    var hour by rememberSaveable { mutableStateOf(initialHour) }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.dl_reminder_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(Res.string.dl_reminder_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(enabled = !state.reminderSaving, onClick = { hour = (hour + 23) % 24; vm.setReminderHour(hour) }) { Text("−") }
                Text(hourLabel(hour), fontWeight = FontWeight.SemiBold)
                OutlinedButton(enabled = !state.reminderSaving, onClick = { hour = (hour + 1) % 24; vm.setReminderHour(hour) }) { Text("+") }
            }
            Text(stringResource(Res.string.dl_reminder_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (state.reminderSaving) Text(stringResource(Res.string.dl_saving), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (state.reminderError) Text(stringResource(Res.string.dl_error), color = MaterialTheme.colorScheme.error)
        }
    }
}

/**
 * "Easier" / "Harder" for one plan day. [onChanged] runs after a swap that changed exercises, so the
 * host can reload the plan it shows.
 */
@Composable
fun DayDifficultyButtons(weekday: Int, onChanged: () -> Unit = {}, modifier: Modifier = Modifier) {
    val vm: DailyViewModel = koinViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val note = state.difficultyNote?.takeIf { it.weekday == weekday }
    LaunchedEffect(note) { if (note != null && note.swapped > 0) onChanged() }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = state.difficultyBusy == null, onClick = { vm.stepDifficulty(weekday, up = false) }) {
                Text(stringResource(Res.string.dl_diff_easier))
            }
            OutlinedButton(enabled = state.difficultyBusy == null, onClick = { vm.stepDifficulty(weekday, up = true) }) {
                Text(stringResource(Res.string.dl_diff_harder))
            }
        }
        if (note != null) {
            Text(if (note.swapped > 0) stringResource(Res.string.dl_diff_swapped, note.swapped) else stringResource(Res.string.dl_diff_none), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.difficultyError) Text(stringResource(Res.string.dl_error), color = MaterialTheme.colorScheme.error)
    }
}

/**
 * The evening checklist: what is still unlogged today. [onOpen] receives the survey key ("food",
 * "water", "steps", "checkin"); map it with [checklistTargetOf]. Hidden once the day is complete.
 */
@Composable
fun EveningChecklistCard(onOpen: (key: String) -> Unit, refreshKey: Any = Unit, modifier: Modifier = Modifier) {
    val vm: DailyViewModel = koinViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(refreshKey) { vm.loadSurvey() }
    val items = state.survey.orEmpty()
    if (items.isEmpty()) return

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.dl_checklist_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(stringResource(Res.string.dl_checklist_hint, items.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
            items.forEach { item ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(item.label, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { onOpen(item.key) }) { Text(stringResource(Res.string.dl_checklist_open)) }
                }
            }
        }
    }
}
