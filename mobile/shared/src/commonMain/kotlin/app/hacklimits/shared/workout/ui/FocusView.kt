package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_cancel_btn
import app.hacklimits.shared.resources.wk_controlled_reps
import app.hacklimits.shared.resources.wk_exercise_sets_line
import app.hacklimits.shared.resources.wk_field_load
import app.hacklimits.shared.resources.wk_field_meters
import app.hacklimits.shared.resources.wk_field_reps
import app.hacklimits.shared.resources.wk_field_seconds
import app.hacklimits.shared.resources.wk_focus_muscles_label
import app.hacklimits.shared.resources.wk_focus_next
import app.hacklimits.shared.resources.wk_focus_note_label
import app.hacklimits.shared.resources.wk_focus_prev
import app.hacklimits.shared.resources.wk_measured_effort
import app.hacklimits.shared.resources.wk_ph_kg
import app.hacklimits.shared.resources.wk_ph_m
import app.hacklimits.shared.resources.wk_ph_sec
import app.hacklimits.shared.resources.wk_set_edit_aria
import app.hacklimits.shared.resources.wk_set_remove_btn
import app.hacklimits.shared.resources.wk_set_rpe_label
import app.hacklimits.shared.resources.wk_swap_search_btn
import app.hacklimits.shared.resources.wk_swap_search_placeholder
import app.hacklimits.shared.resources.wk_swapped_from_note
import app.hacklimits.shared.resources.wk_target_last
import app.hacklimits.shared.resources.wk_target_today
import app.hacklimits.shared.resources.wk_train_add_set_btn
import app.hacklimits.shared.resources.wk_train_as_planned_btn
import app.hacklimits.shared.resources.wk_train_delete_btn
import app.hacklimits.shared.resources.wk_train_info_btn
import app.hacklimits.shared.resources.wk_train_move_down
import app.hacklimits.shared.resources.wk_train_move_up
import app.hacklimits.shared.resources.wk_train_no_swaps
import app.hacklimits.shared.resources.wk_train_rest_auto
import app.hacklimits.shared.resources.wk_train_rest_prefs_aria
import app.hacklimits.shared.resources.wk_train_rest_sound
import app.hacklimits.shared.resources.wk_train_repeat_last_btn
import app.hacklimits.shared.resources.wk_train_swap_btn
import app.hacklimits.shared.resources.wk_train_rest_for
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.RowDraft
import app.hacklimits.shared.muscles.ExerciseMuscles
import app.hacklimits.shared.muscles.classify
import app.hacklimits.shared.workout.logic.Slug
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.LoggerSet
import app.hacklimits.shared.workout.logic.isSetFilled
import app.hacklimits.shared.workout.logic.plannedSetsFor
import app.hacklimits.shared.workout.logic.suggestionFor
import org.jetbrains.compose.resources.stringResource
import kotlin.math.max
import kotlin.math.min

private val REST_CHOICES = listOf(45, 60, 90, 120, 180)
private val RPE_CHOICES = listOf(6, 7, 8, 9, 10)

/**
 * One exercise on screen (focus mode): its name, target and technique cue, and the sets as a table --
 * set, load, reps, done. A planned set is logged with one tap on its check; tapping the row opens it
 * for editing. Less frequent actions open from the "more" button.
 */
@Composable
fun FocusView(vm: LoggerViewModel, s: LoggerUi, at: Int) {
    val exercises = s.exercises
    val ex = exercises[at]
    val key = "${ex.index}-${ex.name}"
    val restSec = vm.restSecFor(ex)
    val main = when (ex.metric) {
        "time" -> "seconds"
        "distance" -> "meters"
        else -> "reps"
    }
    val reps = ex.metric == "reps"
    val sets = ex.done
    val rows = max(max(1, ex.sets), sets.size)
    fun isDone(i: Int) = sets.getOrNull(i)?.let(::isSetFilled) == true
    fun seed(i: Int): LoggerSet {
        val base = if (isDone(i)) sets[i] else suggestionFor(ex, i)
        val weight = sets.getOrNull(i)?.weight ?: 0.0
        return if (!isDone(i) && weight != 0.0) base.copy(weight = weight) else base
    }
    fun amount(set: LoggerSet): Double = when (main) {
        "seconds" -> set.seconds ?: 0.0
        "meters" -> set.meters ?: 0.0
        else -> set.reps
    }
    fun firstOpen(): Int? = (0 until rows).firstOrNull { !isDone(it) }

    val draft = s.rowDrafts[key]?.takeIf { it.row < rows }
    var rpeOpen by rememberSaveable(key) { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val mainFocus = remember(key) { FocusRequester() }
    val rowRestLabels = (0 until rows).map { i -> stringResource(Res.string.wk_train_rest_for, ex.name, i + 1) }

    fun commit(i: Int, value: LoggerSet) {
        if (!(amount(value) > 0)) return
        vm.writeSet(ex.index, i, value)
        vm.setRowDraft(key, null)
        rpeOpen = false
        if (s.restPrefs.auto) vm.startRest(restSec, rowRestLabels[i], ex.name)
    }

    fun undo(i: Int) {
        val previous = seed(i)
        val old = sets[i]
        vm.writeSet(
            ex.index, i,
            old.copy(
                reps = 0.0,
                seconds = if (ex.metric == "time") 0.0 else old.seconds,
                meters = if (ex.metric == "distance") 0.0 else old.meters,
            ),
        )
        vm.setRowDraft(key, RowDraft(i, previous))
    }

    fun typeField(field: String, raw: String) {
        val d = draft ?: return
        val value = parseTyped(raw)
        val set = when (field) {
            "weight" -> d.set.copy(weight = value)
            "reps" -> d.set.copy(reps = value)
            "seconds" -> d.set.copy(seconds = value)
            else -> d.set.copy(meters = value)
        }
        vm.setRowDraft(key, RowDraft(d.row, set, d.text + (field to raw)))
    }

    val mainHead = stringResource(
        when (main) {
            "seconds" -> Res.string.wk_field_seconds
            "meters" -> Res.string.wk_field_meters
            else -> Res.string.wk_field_reps
        },
    )
    val unit = when (main) {
        "seconds" -> stringResource(Res.string.wk_ph_sec)
        "meters" -> stringResource(Res.string.wk_ph_m)
        else -> ""
    }
    val targetLine = ex.planSets?.let { plan ->
        val weight = ex.planWeight?.takeIf { it.isNotBlank() && it != "—" }
        if (weight != null) "$plan · $weight" else plan
    } ?: stringResource(
        Res.string.wk_exercise_sets_line,
        ex.sets,
        stringResource(if (reps) Res.string.wk_controlled_reps else Res.string.wk_measured_effort),
    )
    val muscles = classify(ex.name) ?: ex.planName?.let { classify(it) }
    val cue = techniqueCue(ex.technique)
    val next = exercises.getOrNull(at + 1)
    val prev = exercises.getOrNull(at - 1)

    Column(
        Modifier.fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(ex.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(targetLine, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ex.target?.let { target ->
            Text(
                "${stringResource(Res.string.wk_target_last, setLabel(target.lastW, target.lastR))} → " +
                    stringResource(Res.string.wk_target_today, setLabel(target.w, target.r)),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        ex.planName?.let { Text(stringResource(Res.string.wk_swapped_from_note, it), style = MaterialTheme.typography.bodySmall) }
        ex.note?.takeIf { it.isNotBlank() }?.let { note ->
            Text("${stringResource(Res.string.wk_focus_note_label)} $note", style = MaterialTheme.typography.bodyMedium)
        }
        muscles?.takeIf { it.primary.isNotEmpty() }?.let { MusclesLine(it, s.musclesOpen, vm::toggleMuscles) }
        if (cue.isNotEmpty() || s.infoFor == ex.index) {
            OutlinedButton(onClick = { vm.openInfo(ex) }, modifier = Modifier.fillMaxWidth()) {
                Text("i  " + cue.ifEmpty { stringResource(Res.string.wk_train_info_btn) })
            }
        }

        if (s.menuOpen) ActionMenu(vm, s, ex, restSec)
        if (s.restPrefsFor == ex.index) RestChoices(vm, s, ex)
        if (s.swapFor == ex.index) SwapPanel(vm, s, ex)
        if (s.infoFor == ex.index) ExerciseInfoPanel(vm, s, ex)

        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("#", Modifier.width(36.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (reps) Text(stringResource(Res.string.wk_field_load), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(mainHead, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(48.dp))
            }
            for (i in 0 until rows) {
                if (draft != null && draft.row == i) {
                    val v = draft.set
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}", Modifier.width(36.dp), fontWeight = FontWeight.Bold)
                        if (reps) {
                            SetField(
                                value = draft.text["weight"] ?: fmtNum(v.weight),
                                label = stringResource(Res.string.wk_field_load),
                                suffix = stringResource(Res.string.wk_ph_kg),
                                modifier = Modifier.weight(1f),
                                decimal = true,
                                imeAction = ImeAction.Next,
                                onNext = { mainFocus.requestFocus() },
                                onChange = { typeField("weight", it) },
                            )
                            Spacer(Modifier.width(8.dp))
                        }
                        SetField(
                            value = draft.text[main] ?: fmtNum(amount(v)),
                            label = mainHead,
                            suffix = unit,
                            modifier = Modifier.weight(1f).focusRequester(mainFocus),
                            decimal = main == "meters",
                            imeAction = ImeAction.Done,
                            onDone = { commit(i, v) },
                            onChange = { typeField(main, it) },
                        )
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = { commit(i, v) },
                            enabled = amount(v) > 0,
                            modifier = Modifier.width(48.dp),
                        ) { Text("✓") }
                    }
                    if (rows > 1 || rpeOpen || v.rpe != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (rpeOpen || v.rpe != null) {
                                RPE_CHOICES.forEach { rpe ->
                                    val on = v.rpe == rpe.toDouble()
                                    OutlinedButton(
                                        onClick = {
                                            vm.setRowDraft(key, draft.copy(set = v.copy(rpe = if (on) null else rpe.toDouble())))
                                        },
                                    ) { Text(rpe.toString(), fontWeight = if (on) FontWeight.Bold else null) }
                                }
                            } else {
                                TextButton(onClick = { rpeOpen = true }) { Text("+ " + stringResource(Res.string.wk_set_rpe_label)) }
                            }
                            if (rows > 1) {
                                TextButton(onClick = { vm.removeSet(ex.index, i); vm.setRowDraft(key, null) }) {
                                    Text(stringResource(Res.string.wk_set_remove_btn), color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                } else {
                    val done = isDone(i)
                    val shown = if (done) sets[i] else suggestionFor(ex, i)
                    val open = !done && firstOpen() == i
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            Modifier.weight(1f).clickable(
                                onClickLabel = stringResource(Res.string.wk_set_edit_aria, i + 1),
                            ) { vm.setRowDraft(key, RowDraft(i, seed(i))) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "${i + 1}",
                                Modifier.width(36.dp),
                                fontWeight = if (open) FontWeight.Bold else null,
                            )
                            if (reps) {
                                Text(
                                    if (shown.weight > 0) "${fmtNum(shown.weight)} ${stringResource(Res.string.wk_ph_kg)}" else "BW",
                                    Modifier.weight(1f),
                                )
                            }
                            val value = amount(shown)
                            Text(
                                buildString {
                                    append(fmtNum(value))
                                    if (unit.isNotEmpty()) append(" ").append(unit)
                                    if (done && shown.rpe != null) append(" · RPE ").append(fmtNum(shown.rpe!!))
                                },
                                Modifier.weight(1f),
                            )
                        }
                        if (done) {
                            OutlinedButton(
                                onClick = { undo(i) },
                                modifier = Modifier.width(48.dp),
                            ) { Text("✓", fontWeight = FontWeight.Bold) }
                        } else {
                            Button(
                                onClick = { commit(i, seed(i)) },
                                modifier = Modifier.width(48.dp),
                            ) { Text("✓") }
                        }
                    }
                }
            }
        }

        OutlinedButton(onClick = { vm.addSet(ex.index) }, modifier = Modifier.fillMaxWidth()) {
            Text("+ " + stringResource(Res.string.wk_train_add_set_btn).replace(Regex("^\\+\\s*"), ""))
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            if (prev != null) {
                TextButton(onClick = { vm.goToExercise(prev.index) }) { Text("‹ " + stringResource(Res.string.wk_focus_prev)) }
            } else {
                Spacer(Modifier.width(1.dp))
            }
            if (next != null) {
                TextButton(onClick = { vm.goToExercise(next.index) }) {
                    Text("${stringResource(Res.string.wk_focus_next)}: ${next.name} ›")
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun SetField(
    value: String,
    label: String,
    suffix: String,
    modifier: Modifier,
    decimal: Boolean,
    imeAction: ImeAction,
    onChange: (String) -> Unit,
    onNext: () -> Unit = {},
    onDone: () -> Unit = {},
) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw -> onChange(raw.filter { it.isDigit() || (decimal && (it == '.' || it == ',')) }.take(7)) },
        label = { Text(label) },
        suffix = { if (suffix.isNotEmpty()) Text(suffix) },
        singleLine = true,
        modifier = modifier,
        keyboardOptions = KeyboardOptions(
            keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number,
            imeAction = imeAction,
        ),
        keyboardActions = KeyboardActions(onNext = { onNext() }, onDone = { onDone() }),
    )
}

@Composable
private fun MusclesLine(muscles: ExerciseMuscles, open: Boolean, onToggle: () -> Unit) {
    val primaryNames = muscles.primary.mapNotNull(Slug::ofKey).map { stringResource(muscleRes(it)) }.joinToString(", ")
    val secondaryNames = muscles.secondary.mapNotNull(Slug::ofKey).map { stringResource(muscleRes(it)) }.joinToString(", ")
    Column(Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(vertical = 4.dp)) {
        Text(stringResource(Res.string.wk_focus_muscles_label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            primaryNames,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
        if (muscles.secondary.isNotEmpty()) {
            Text(
                secondaryNames,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ActionMenu(vm: LoggerViewModel, s: LoggerUi, ex: LoggerExercise, restSec: Int) {
    val exerciseName = ex.name
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(onClick = { vm.fillPlanned(ex.index); vm.closeMenu() }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.wk_train_as_planned_btn))
        }
        if (!ex.last.isNullOrEmpty()) {
            OutlinedButton(onClick = { vm.fillLast(ex.index); vm.closeMenu() }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(Res.string.wk_train_repeat_last_btn))
            }
        }
        OutlinedButton(onClick = { vm.openSwap(ex.index) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.wk_train_swap_btn))
        }
        OutlinedButton(onClick = { vm.startRest(restSec, exerciseName, exerciseName); vm.closeMenu() }, modifier = Modifier.fillMaxWidth()) {
            Text("⏱ $restSec ${stringResource(Res.string.wk_ph_sec)}")
        }
        OutlinedButton(onClick = { vm.toggleRestPrefs(ex.index) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.wk_train_rest_prefs_aria))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.moveExercise(ex.index, -1); vm.closeMenu() }) { Text(stringResource(Res.string.wk_train_move_up)) }
            OutlinedButton(onClick = { vm.moveExercise(ex.index, 1); vm.closeMenu() }) { Text(stringResource(Res.string.wk_train_move_down)) }
            OutlinedButton(onClick = { vm.removeExercise(ex.index) }) {
                Text(stringResource(Res.string.wk_train_delete_btn), color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun RestChoices(vm: LoggerViewModel, s: LoggerUi, ex: LoggerExercise) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            REST_CHOICES.forEach { sec ->
                val on = vm.restSecFor(ex) == sec
                OutlinedButton(onClick = { vm.pickRest(ex.name, sec) }) {
                    Text("$sec ${stringResource(Res.string.wk_ph_sec)}", fontWeight = if (on) FontWeight.Bold else null)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = { vm.patchRestPrefs(auto = !s.restPrefs.auto) }) {
                Text(stringResource(Res.string.wk_train_rest_auto) + if (s.restPrefs.auto) " ✓" else "")
            }
            OutlinedButton(onClick = { vm.patchRestPrefs(sound = !s.restPrefs.sound) }) {
                Text(stringResource(Res.string.wk_train_rest_sound) + if (s.restPrefs.sound) " ✓" else "")
            }
        }
    }
}

@Composable
private fun SwapPanel(vm: LoggerViewModel, s: LoggerUi, ex: LoggerExercise) {
    var query by rememberSaveable(ex.index) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (s.swapChoices.isEmpty()) {
            Text(stringResource(Res.string.wk_train_no_swaps), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            s.swapChoices.forEach { choice ->
                OutlinedButton(onClick = { vm.pickSwap(choice) }, modifier = Modifier.fillMaxWidth()) { Text(choice.name) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(80) },
                placeholder = { Text(stringResource(Res.string.wk_swap_search_placeholder)) },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { vm.searchSwap(ex.index, query); query = "" },
                enabled = s.busy == null,
            ) { Text(stringResource(Res.string.wk_swap_search_btn)) }
        }
        TextButton(onClick = { vm.closeSwap() }) { Text(stringResource(Res.string.wk_cancel_btn)) }
    }
}
