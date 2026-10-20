package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.workout.LoggedExercise
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.LoggerViewModel.State
import org.jetbrains.compose.resources.stringResource

@Composable
fun LoggerScreen(vm: LoggerViewModel, onClose: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val restTitle = stringResource(Res.string.rest_over_title)
    val restBody = stringResource(Res.string.rest_over_body)
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.workout_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        when (val s = state) {
            State.Loading -> Centered { CircularProgressIndicator() }
            State.RestDay -> Centered { Text(stringResource(Res.string.workout_rest_day)) }
            is State.Error -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(errorText(s.code)), color = MaterialTheme.colorScheme.error)
                    Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
                }
            }
            is State.Done -> Centered {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        stringResource(if (s.savedOffline) Res.string.workout_saved_offline else Res.string.workout_saved),
                        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                    )
                    s.result?.prExercises?.takeIf { it.isNotEmpty() }?.let { Text(stringResource(Res.string.workout_prs, it.joinToString())) }
                    s.result?.newBadges?.forEach { Text("🏅 $it") }
                    Button(onClick = onClose) { Text(stringResource(Res.string.done)) }
                }
            }
            is State.Logging -> Logging(s, vm, restTitle, restBody)
        }
    }
}

@Composable
private fun Logging(s: State.Logging, vm: LoggerViewModel, restTitle: String, restBody: String) {
    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { s.today.title?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
            itemsIndexed(s.draft.exercises) { i, ex ->
                ExerciseCard(ex, s.today.exercises.getOrNull(i)?.note, onEdit = { set, change -> vm.edit(i, set, change) },
                    onToggle = { set -> vm.toggleDone(i, set, restTitle, restBody) }, onAddSet = { vm.addSet(i) })
            }
        }
        Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), tonalElevation = 3.dp) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                s.restLeft?.let { left ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(Res.string.rest_left, left / 60, (left % 60).toString().padStart(2, '0')),
                            style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                        )
                        TextButton(onClick = vm::stopRest) { Text(stringResource(Res.string.rest_skip)) }
                    }
                }
                s.error?.let { Text(stringResource(if (it == "nothing_logged") Res.string.workout_nothing_logged else errorText(it)), color = MaterialTheme.colorScheme.error) }
                Button(onClick = vm::finish, enabled = !s.saving, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(stringResource(Res.string.workout_finish))
                }
            }
        }
    }
}

@Composable
private fun ExerciseCard(
    ex: LoggedExercise,
    note: String?,
    onEdit: (Int, (app.hacklimits.shared.workout.SetRow) -> app.hacklimits.shared.workout.SetRow) -> Unit,
    onToggle: (Int) -> Unit,
    onAddSet: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(ex.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            note?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ex.sets.forEachIndexed { j, row ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${j + 1}", Modifier.width(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    when (ex.metric) {
                        "time" -> NumberField(row.seconds, stringResource(Res.string.unit_seconds), Modifier.weight(1f)) { v -> onEdit(j) { it.copy(seconds = v) } }
                        "distance" -> NumberField(row.meters, stringResource(Res.string.unit_meters), Modifier.weight(1f)) { v -> onEdit(j) { it.copy(meters = v) } }
                        else -> {
                            NumberField(row.weight, stringResource(Res.string.unit_kg), Modifier.weight(1f), decimal = true) { v -> onEdit(j) { it.copy(weight = v) } }
                            NumberField(row.reps, stringResource(Res.string.unit_reps), Modifier.weight(1f)) { v -> onEdit(j) { it.copy(reps = v) } }
                        }
                    }
                    Checkbox(checked = row.done, onCheckedChange = { onToggle(j) })
                }
            }
            TextButton(onClick = onAddSet) { Text(stringResource(Res.string.workout_add_set)) }
        }
    }
}

@Composable
private fun NumberField(value: String, label: String, modifier: Modifier, decimal: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw -> onChange(raw.filter { it.isDigit() || (decimal && (it == '.' || it == ',')) }.take(7)) },
        label = { Text(label) },
        singleLine = true,
        modifier = modifier,
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
    )
}

@Composable
private fun Centered(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
