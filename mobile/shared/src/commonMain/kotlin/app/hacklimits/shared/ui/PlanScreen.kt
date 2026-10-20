package app.hacklimits.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.CatalogExercise
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.data.PlanEdit
import app.hacklimits.shared.plan.BalanceCard
import app.hacklimits.shared.plan.KitFitCard
import app.hacklimits.shared.plan.LibraryBrowser
import app.hacklimits.shared.plan.MesocycleCard
import app.hacklimits.shared.plan.PlanViewModel
import app.hacklimits.shared.plan.RebuildPlanCard
import app.hacklimits.shared.plan.planBalance
import app.hacklimits.shared.plan.weekdayLabel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

private val DAY_GROUPS = listOf("chest", "back", "legs", "shoulders", "arms", "full", "core")

/** The bottom sheets of the editor: one exercise, the exercise picker (add or swap), or a new training day. */
private sealed interface PlanSheet {
    data class Exercise(val weekday: Int, val index: Int) : PlanSheet
    data class Pick(val weekday: Int, val swapIndex: Int? = null, val swapName: String? = null) : PlanSheet
    data class AddDay(val weekday: Int) : PlanSheet
}

/**
 * The weekly plan editor (Mini App PlanView): the schedule by day, an exercise sheet (sets, weight,
 * note, technique, swap, video, reorder, superset, delete), the library and catalog pickers, adding
 * or removing whole days, the balance check, equipment fit, the training-block overlay, rebuild and
 * the change log. [onOpenLibrary] opens the exercise library screen (omit to hide the entry).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PlanScreen(vm: PlanViewModel, onClose: () -> Unit, onOpenLibrary: (() -> Unit)? = null) {
    val s by vm.state.collectAsStateWithLifecycle()
    val plan = s.plan
    var sheet by remember { mutableStateOf<PlanSheet?>(null) }
    var openDay by rememberSaveable { mutableStateOf<Int?>(null) }
    var showChanges by remember { mutableStateOf(false) }
    val balance = remember(plan?.days) { plan?.days?.let { planBalance(it) }.orEmpty() }
    val ownPlan = vm.clientId == null
    val title = if (!ownPlan) stringResource(Res.string.pl_plan_owner_title, plan?.owner?.name.orEmpty()) else stringResource(Res.string.pl_plan_schedule_title)

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text(stringResource(Res.string.back)) }
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                plan == null && s.loading -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                plan == null -> item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(if (s.loadError == "unauthorized") Res.string.pl_unauthorized_error else Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
                        Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
                    }
                }
                plan.days.isEmpty() -> item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(Res.string.pl_no_plan_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(stringResource(Res.string.pl_no_plan_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                else -> {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(stringResource(Res.string.pl_days_count, plan.days.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    s.actionError?.let { code ->
                        item {
                            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                                Row(Modifier.padding(12.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        stringResource(if (code == "last_exercise") Res.string.pl_plan_last_exercise else Res.string.pl_generic_error),
                                        modifier = Modifier.weight(1f),
                                    )
                                    TextButton(onClick = vm::dismissActionError) { Text(stringResource(Res.string.pl_close)) }
                                }
                            }
                        }
                    }
                    if (s.saved != null) item { Text(stringResource(Res.string.pl_plan_updated), color = MaterialTheme.colorScheme.primary) }

                    items((1..7).toList(), key = { it }) { weekday ->
                        val day = plan.days.firstOrNull { it.weekday == weekday }
                        if (day == null) {
                            Card(
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                                modifier = Modifier.fillMaxWidth().clickable(enabled = plan.days.size < 7) { sheet = PlanSheet.AddDay(weekday) },
                            ) {
                                Row(Modifier.padding(14.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(stringResource(weekdayLabel(weekday)), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.25f))
                                    Text(stringResource(Res.string.pl_plan_rest_day), modifier = Modifier.weight(1f))
                                    Text("+", style = MaterialTheme.typography.titleLarge)
                                }
                            }
                        } else {
                            val open = openDay == weekday
                            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                                Column {
                                    Row(
                                        Modifier.fillMaxWidth().clickable { openDay = if (open) null else weekday }.padding(14.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(stringResource(weekdayLabel(weekday)), color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(0.25f), fontWeight = FontWeight.SemiBold)
                                        Column(Modifier.weight(1f)) {
                                            Text(day.muscleGroup.ifBlank { day.name }, fontWeight = FontWeight.SemiBold)
                                            Text(
                                                stringResource(Res.string.pl_plan_day_meta, day.exercises.size),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Text(if (open) "⌃" else "⌄", style = MaterialTheme.typography.titleMedium)
                                    }
                                    if (open) {
                                        Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            day.exercises.forEach { ex ->
                                                Column(
                                                    Modifier.fillMaxWidth().clickable { sheet = PlanSheet.Exercise(weekday, ex.index) }.padding(vertical = 8.dp),
                                                ) {
                                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                                        Text(ex.name, fontWeight = FontWeight.SemiBold)
                                                        ex.ssGroup?.let {
                                                            Text(
                                                                "  " + stringResource(Res.string.pl_plan_superset_label, it),
                                                                style = MaterialTheme.typography.labelSmall,
                                                                color = MaterialTheme.colorScheme.primary,
                                                            )
                                                        }
                                                    }
                                                    val line = listOf(ex.sets, ex.startWeight).filter { it.isNotBlank() && it != "—" }.joinToString(" · ")
                                                    if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                    ex.note?.takeIf { it.isNotBlank() }?.let {
                                                        Text("💬 $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                    }
                                                }
                                            }
                                            OutlinedButton(onClick = { sheet = PlanSheet.Pick(weekday) }, enabled = s.busy == null, modifier = Modifier.fillMaxWidth()) {
                                                Text(stringResource(Res.string.pl_plan_add_exercise_btn))
                                            }
                                            if (plan.days.size > 1) {
                                                TextButton(
                                                    onClick = { vm.removeDay(weekday) },
                                                    enabled = s.busy == null,
                                                    modifier = Modifier.fillMaxWidth(),
                                                ) {
                                                    Text(
                                                        stringResource(if (s.busy == "day:del:$weekday") Res.string.pl_saving_ellipsis else Res.string.pl_plan_day_remove_btn),
                                                        color = MaterialTheme.colorScheme.error,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (balance.isNotEmpty()) item {
                        BalanceCard(balance, busy = s.busy != null) { weekday, name ->
                            vm.edit(PlanEdit("add", weekday = weekday, index = -1, value = name))
                        }
                    }
                    plan.kit?.takeIf { it.mismatches > 0 }?.let { kit ->
                        item { KitFitCard(kit, busy = s.busy == "fitkit", onFit = vm::fitKit) }
                    }
                    item { MesocycleCard(plan.mesocycle, busy = s.busy == "meso", onToggle = vm::setMesocycle) }
                    if (ownPlan) item { RebuildPlanCard(s.replan, s.replanError, onStart = vm::startReplan) }
                    if (plan.changes.isNotEmpty()) item {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Row(
                                    Modifier.fillMaxWidth().clickable { showChanges = !showChanges }.padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(stringResource(Res.string.pl_plan_changes_title), modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                    Text(if (showChanges) "⌃" else "⌄")
                                }
                                if (showChanges) Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    plan.changes.forEachIndexed { i, change ->
                                        Column(Modifier.fillMaxWidth()) {
                                            Text(change.summary, fontWeight = FontWeight.SemiBold)
                                            Text(
                                                "${changeSourceLabel(change.source)?.let { stringResource(it) } ?: change.source} · ${change.at.take(10)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (ownPlan && onOpenLibrary != null) item {
                        OutlinedButton(onClick = onOpenLibrary, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.pl_library_open_btn)) }
                    }
                }
            }
        }
    }

    val current = sheet
    if (current != null && plan != null) {
        val dismiss = { sheet = null }
        ModalBottomSheet(onDismissRequest = dismiss) {
            when (current) {
                is PlanSheet.Exercise -> ExerciseSheet(vm, s, plan, current.weekday, current.index, onOpenPick = { sheet = it }, onClose = dismiss)
                is PlanSheet.Pick -> PickSheet(vm, s.busy, current, onClose = dismiss, onAdded = { weekday -> openDay = weekday })
                is PlanSheet.AddDay -> AddDaySheet(vm, s.busy, current.weekday, onClose = dismiss, onAdded = { weekday -> openDay = weekday })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExerciseSheet(
    vm: PlanViewModel,
    state: PlanViewModel.State,
    plan: Plan,
    weekday: Int,
    index: Int,
    onOpenPick: (PlanSheet.Pick) -> Unit,
    onClose: () -> Unit,
) {
    val forClient = vm.clientId != null
    val day = plan.days.firstOrNull { it.weekday == weekday }
    val ex = day?.exercises?.firstOrNull { it.index == index }
    if (day == null || ex == null) {
        onClose()
        return
    }
    val busy = state.busy
    val catalogKey = "swap:$weekday:$index"
    var weight by remember(index, ex.name) { mutableStateOf(ex.startWeight) }
    var sets by remember(index, ex.name) { mutableStateOf(ex.sets) }
    var note by remember(index, ex.name) { mutableStateOf(ex.note.orEmpty()) }
    var technique by remember(index, ex.name) { mutableStateOf(ex.technique.orEmpty()) }
    var video by remember(index, ex.name) { mutableStateOf("") }
    var swapQuery by remember(index, ex.name) { mutableStateOf("") }
    var confirmDelete by remember(index, ex.name) { mutableStateOf(false) }
    val weightChanged = weight != ex.startWeight
    val setsChanged = sets != ex.sets
    val lastIndex = day.exercises.lastIndex
    val expect = ex.name

    Column(
        Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(ex.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        val wmode = ex.wmode?.let { stringResource(wmodeLabel(it)) }
        Text(
            listOfNotNull(stringResource(weekdayLabel(weekday)), ex.sets, ex.startWeight.takeIf { it.isNotBlank() && it != "—" }, wmode).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(weight, { weight = it.take(40) }, label = { Text(stringResource(Res.string.pl_weight_label)) }, singleLine = true, modifier = Modifier.weight(1f))
            OutlinedTextField(sets, { sets = it.take(40) }, label = { Text(stringResource(Res.string.pl_sets_label)) }, singleLine = true, modifier = Modifier.weight(1f))
        }
        Button(
            onClick = {
                val saveSets = { if (setsChanged) vm.edit(PlanEdit("sets", weekday, index, value = sets, expectName = expect)) }
                if (weightChanged) vm.edit(PlanEdit("weight", weekday, index, value = weight, expectName = expect), onDone = saveSets)
                else saveSets()
            },
            enabled = busy == null && (weightChanged || setsChanged),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(if (busy != null && (weightChanged || setsChanged)) Res.string.pl_saving_ellipsis else Res.string.pl_save_btn))
        }

        OutlinedTextField(
            note, { note = it.take(300) },
            label = { Text(stringResource(if (forClient) Res.string.pl_plan_note_label_client else Res.string.pl_plan_note_label)) },
            placeholder = { Text(stringResource(Res.string.pl_plan_note_ph)) },
            modifier = Modifier.fillMaxWidth(),
        )
        if (note != ex.note.orEmpty()) {
            Button(onClick = { vm.edit(PlanEdit("note", weekday, index, value = note, expectName = expect)) }, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(Res.string.pl_plan_note_save))
            }
        }

        OutlinedTextField(
            technique, { technique = it.take(1000) },
            label = { Text(stringResource(Res.string.pl_plan_technique_label)) },
            placeholder = { Text(stringResource(Res.string.pl_plan_technique_ph)) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        if (technique.isNotBlank() && technique != ex.technique.orEmpty()) {
            Button(onClick = { vm.edit(PlanEdit("technique", weekday, index, value = technique, expectName = expect)) }, enabled = busy == null, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(Res.string.pl_plan_technique_save))
            }
        }

        Text(stringResource(Res.string.pl_plan_swap_btn), style = MaterialTheme.typography.labelLarge)
        OutlinedButton(onClick = { onOpenPick(PlanSheet.Pick(weekday, index, ex.name)) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.pl_plan_pick_library))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                swapQuery, { swapQuery = it.take(80) },
                placeholder = { Text(stringResource(Res.string.pl_plan_swap_ph)) },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            val searching = state.catalogBusy == catalogKey
            OutlinedButton(
                onClick = { vm.searchCatalog(catalogKey, swapQuery) },
                enabled = !searching && swapQuery.trim().length >= 2,
            ) { Text(stringResource(Res.string.pl_plan_catalog_search)) }
        }
        val results = state.catalog[catalogKey]
        results?.let { items ->
            if (items.isEmpty()) Text(stringResource(Res.string.pl_plan_catalog_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            items.forEach { choice: CatalogExercise ->
                OutlinedButton(
                    onClick = {
                        vm.edit(PlanEdit("swap", weekday, index, value = choice.name, expectName = expect, catalogId = choice.id)) {
                            vm.clearCatalog(catalogKey)
                            swapQuery = ""
                            onClose()
                        }
                    },
                    enabled = busy == null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.fillMaxWidth()) {
                        Text(choice.name, fontWeight = FontWeight.SemiBold)
                        if (choice.muscle.isNotBlank()) Text(choice.muscle, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        Text(stringResource(Res.string.pl_plan_video_label), style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(video, { video = it.take(300) }, placeholder = { Text(stringResource(Res.string.pl_plan_video_ph)) }, singleLine = true, modifier = Modifier.weight(1f))
            OutlinedButton(
                onClick = { vm.edit(PlanEdit("video", weekday, index, value = video.trim(), expectName = expect)) { video = "" } },
                enabled = busy == null && video.trim().isNotEmpty(),
            ) { Text(stringResource(Res.string.pl_plan_video_save)) }
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.edit(PlanEdit("move", weekday, index, dir = "up", expectName = expect), onDone = onClose) }, enabled = busy == null && index != 0) {
                Text(stringResource(Res.string.pl_plan_move_up))
            }
            OutlinedButton(
                onClick = { vm.edit(PlanEdit("move", weekday, index, dir = "down", expectName = expect), onDone = onClose) },
                enabled = busy == null && index != lastIndex,
            ) { Text(stringResource(Res.string.pl_plan_move_down)) }
            if (index < lastIndex) {
                OutlinedButton(onClick = { vm.edit(PlanEdit("link", weekday, index, expectName = expect), onDone = onClose) }, enabled = busy == null) {
                    Text(stringResource(if (ex.ssGroup != null) Res.string.pl_plan_unlink_btn else Res.string.pl_plan_link_btn))
                }
            }
            TextButton(
                onClick = {
                    if (day.exercises.size <= 1) vm.showActionError("last_exercise") else confirmDelete = true
                },
                enabled = busy == null,
            ) { Text(stringResource(Res.string.pl_plan_delete_btn), color = MaterialTheme.colorScheme.error) }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            text = { Text(stringResource(Res.string.pl_plan_delete_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    vm.edit(PlanEdit("del", weekday, index, expectName = expect), onDone = onClose)
                }) { Text(stringResource(Res.string.pl_plan_delete_btn), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(Res.string.pl_close)) } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PickSheet(vm: PlanViewModel, busy: String?, pick: PlanSheet.Pick, onClose: () -> Unit, onAdded: (Int) -> Unit) {
    val weekday = pick.weekday
    val swapIndex = pick.swapIndex
    val swapName = pick.swapName
    val dayLabel = stringResource(weekdayLabel(weekday))
    var ownName by remember(weekday) { mutableStateOf("") }
    val title = if (swapIndex != null && swapName != null) stringResource(Res.string.pl_plan_pick_swap_title, swapName) else stringResource(Res.string.pl_plan_pick_title, dayLabel)

    Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        if (swapIndex == null) {
            Text(stringResource(Res.string.pl_plan_pick_own), style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(ownName, { ownName = it.take(80) }, placeholder = { Text(stringResource(Res.string.pl_plan_add_ph)) }, singleLine = true, modifier = Modifier.weight(1f))
                OutlinedButton(
                    onClick = { vm.edit(PlanEdit("add", weekday, -1, value = ownName.trim())) { onAdded(weekday); onClose() } },
                    enabled = busy == null && ownName.trim().isNotEmpty(),
                ) { Text(stringResource(Res.string.pl_plan_add_btn)) }
            }
        }
        LibraryBrowser(
            loadSteps = { id -> vm.steps(id) },
            action = { entry, name ->
                Button(
                    onClick = {
                        if (swapIndex != null && swapName != null) {
                            vm.edit(PlanEdit("swap", weekday, swapIndex, value = name, expectName = swapName, freeExerciseId = entry.id), onDone = onClose)
                        } else {
                            vm.edit(PlanEdit("add", weekday, -1, value = name, freeExerciseId = entry.id)) { onAdded(weekday); onClose() }
                        }
                    },
                    enabled = busy == null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            busy != null -> stringResource(Res.string.pl_saving_ellipsis)
                            swapIndex != null -> stringResource(Res.string.pl_plan_pick_swap_btn)
                            else -> stringResource(Res.string.pl_plan_pick_add_btn, dayLabel)
                        },
                    )
                }
            },
        )
    }
}

@Composable
private fun AddDaySheet(vm: PlanViewModel, busy: String?, weekday: Int, onClose: () -> Unit, onAdded: (Int) -> Unit) {
    var group by remember { mutableStateOf("chest") }
    Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(Res.string.pl_plan_day_add_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(stringResource(weekdayLabel(weekday)), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.pl_plan_day_group_label), style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            DAY_GROUPS.forEach { g ->
                FilterChip(selected = group == g, onClick = { group = g }, label = { Text(stringResource(dayGroupLabel(g))) })
            }
        }
        Button(
            onClick = { vm.addDay(weekday, group) { onAdded(weekday); onClose() } },
            enabled = busy == null,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(if (busy == "day:add") Res.string.pl_saving_ellipsis else Res.string.pl_plan_day_add_btn))
        }
        Text(stringResource(Res.string.pl_plan_day_add_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun dayGroupLabel(group: String): StringResource = when (group) {
    "back" -> Res.string.pl_plan_day_g_back
    "legs" -> Res.string.pl_plan_day_g_legs
    "shoulders" -> Res.string.pl_plan_day_g_shoulders
    "arms" -> Res.string.pl_plan_day_g_arms
    "full" -> Res.string.pl_plan_day_g_full
    "core" -> Res.string.pl_plan_day_g_core
    else -> Res.string.pl_plan_day_g_chest
}

private fun changeSourceLabel(source: String): StringResource? = when (source) {
    "manual" -> Res.string.pl_plan_change_src_manual
    "trainer" -> Res.string.pl_plan_change_src_trainer
    "ai_coach" -> Res.string.pl_plan_change_src_ai_coach
    "injury_swap" -> Res.string.pl_plan_change_src_injury_swap
    else -> null
}

private fun wmodeLabel(mode: String): StringResource = when (mode) {
    "perSide" -> Res.string.pl_wmode_persidem
    "perHand" -> Res.string.pl_wmode_perhandm
    else -> Res.string.pl_wmode_total
}
