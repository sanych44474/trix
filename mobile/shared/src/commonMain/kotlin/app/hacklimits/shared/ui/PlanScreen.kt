package app.hacklimits.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.CatalogExercise
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.plan.PlanViewModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

private sealed interface Sheet {
    data class Edit(val weekday: Int, val exercise: Plan.Exercise) : Sheet
    data class Pick(val weekday: Int, val replacing: Plan.Exercise?) : Sheet
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(vm: PlanViewModel, onClose: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.plan_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        if (s.reloadedAfterConflict) Text(stringResource(Res.string.plan_reloaded), Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.primary)
        s.error?.let { Text(stringResource(errorText(it)), Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error) }
        val plan = s.plan
        when {
            plan == null && s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            plan == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) } }
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(plan.days, key = { it.weekday }) { day ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${stringResource(weekdayName(day.weekday))} · ${day.name}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            day.exercises.forEach { ex ->
                                Column(Modifier.fillMaxWidth().clickable(enabled = plan.editable) { sheet = Sheet.Edit(day.weekday, ex) }.padding(vertical = 6.dp)) {
                                    Text(ex.name)
                                    Text(listOf(ex.sets, ex.startWeight).filter { it.isNotBlank() }.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    ex.note?.takeIf { it.isNotBlank() }?.let { Text("💬 $it", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                                HorizontalDivider()
                            }
                            if (plan.editable) TextButton(onClick = { sheet = Sheet.Pick(day.weekday, null) }) { Text(stringResource(Res.string.plan_add_exercise)) }
                        }
                    }
                }
            }
        }
    }

    when (val open = sheet) {
        is Sheet.Edit -> ModalBottomSheet(onDismissRequest = { sheet = null }) {
            EditSheet(
                open.exercise,
                busy = s.busy,
                onSave = { sets, weight, note ->
                    if (sets != open.exercise.sets) vm.setSets(open.weekday, open.exercise, sets)
                    if (weight != open.exercise.startWeight) vm.setWeight(open.weekday, open.exercise, weight)
                    if (note != (open.exercise.note ?: "")) vm.setNote(open.weekday, open.exercise, note)
                    sheet = null
                },
                onMove = { up -> vm.move(open.weekday, open.exercise, up); sheet = null },
                onSwap = { sheet = Sheet.Pick(open.weekday, open.exercise) },
                onDelete = { vm.delete(open.weekday, open.exercise); sheet = null },
            )
        }
        is Sheet.Pick -> ModalBottomSheet(onDismissRequest = { sheet = null; vm.search("") }) {
            PickSheet(s.search, onQuery = vm::search) { pick ->
                if (open.replacing != null) vm.swap(open.weekday, open.replacing, pick) else vm.add(open.weekday, pick)
                sheet = null
                vm.search("")
            }
        }
        null -> Unit
    }
}

@Composable
private fun EditSheet(
    ex: Plan.Exercise,
    busy: Boolean,
    onSave: (sets: String, weight: String, note: String) -> Unit,
    onMove: (up: Boolean) -> Unit,
    onSwap: () -> Unit,
    onDelete: () -> Unit,
) {
    var sets by remember(ex) { mutableStateOf(ex.sets) }
    var weight by remember(ex) { mutableStateOf(ex.startWeight) }
    var note by remember(ex) { mutableStateOf(ex.note ?: "") }
    Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(ex.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        OutlinedTextField(sets, { sets = it.take(40) }, label = { Text(stringResource(Res.string.plan_sets)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(weight, { weight = it.take(40) }, label = { Text(stringResource(Res.string.plan_weight)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(note, { note = it.take(300) }, label = { Text(stringResource(Res.string.plan_note)) }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { onSave(sets.trim(), weight.trim(), note.trim()) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.save)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onMove(true) }) { Text("↑") }
            OutlinedButton(onClick = { onMove(false) }) { Text("↓") }
            OutlinedButton(onClick = onSwap) { Text(stringResource(Res.string.plan_swap)) }
            TextButton(onClick = onDelete) { Text(stringResource(Res.string.plan_delete), color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun PickSheet(results: List<CatalogExercise>, onQuery: (String) -> Unit, onPick: (CatalogExercise) -> Unit) {
    var query by remember { mutableStateOf("") }
    Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(query, { query = it; onQuery(it) }, label = { Text(stringResource(Res.string.plan_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        results.take(20).forEach { item ->
            Column(Modifier.fillMaxWidth().clickable { onPick(item) }.padding(vertical = 8.dp)) {
                Text(item.name)
                if (item.muscle.isNotBlank()) Text(item.muscle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

internal fun weekdayName(weekday: Int): StringResource = when (weekday) {
    1 -> Res.string.wd_mon
    2 -> Res.string.wd_tue
    3 -> Res.string.wd_wed
    4 -> Res.string.wd_thu
    5 -> Res.string.wd_fri
    6 -> Res.string.wd_sat
    else -> Res.string.wd_sun
}
