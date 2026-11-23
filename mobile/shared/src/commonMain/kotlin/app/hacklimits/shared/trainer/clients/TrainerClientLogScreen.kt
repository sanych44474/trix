package app.hacklimits.shared.trainer.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/** The days a trainer can log for: the client's today and 14 days back (the server checks the same). */
private fun lastDays(today: String, count: Int = 15): List<String> {
    val parts = today.split("-").mapNotNull { it.toIntOrNull() }
    if (parts.size != 3) return listOf(today)
    // Civil-from-days arithmetic, so no platform date API is needed in common code.
    fun toDays(y0: Int, m: Int, d: Int): Long {
        val y = if (m <= 2) y0 - 1 else y0
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097L + doe - 719468L
    }
    fun fromDays(z0: Long): String {
        val z = z0 + 719468L
        val era = (if (z >= 0) z else z - 146096) / 146097
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = mp + (if (mp < 10) 3 else -9)
        val y = yoe + era * 400 + (if (m <= 2) 1 else 0)
        return "$y-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
    }
    val base = toDays(parts[0], parts[1], parts[2])
    return List(count) { fromDays(base - it) }
}

@Composable
internal fun TrainerClientLogScreen(clientId: Long, voiceFirst: Boolean, onBack: () -> Unit) {
    val vm: TrainerClientLogViewModel = koinViewModel(key = "trainer-log:$clientId", parameters = { parametersOf(clientId) })
    val s by vm.state.collectAsStateWithLifecycle()
    val day = s.day
    var newExercise by remember { mutableStateOf("") }

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item("back") { TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) } }
        item("title") {
            Column {
                Text(stringResource(Res.string.tr_log_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                if (day != null) Text(day.client.name, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (s.loadFailed) item("error") { LoadErrorPanel(onRetry = { vm.load(day?.date) }) }
        if (day == null) return@LazyColumn

        item("days") {
          Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(lastDays(day.client.today.ifEmpty { day.date })) { d ->
                    FilterChip(
                        selected = d == day.date,
                        onClick = { if (d != day.date) vm.load(d) },
                        label = { Text(if (d == day.client.today) stringResource(Res.string.tr_log_today) else d.substring(5), maxLines = 1) },
                    )
                }
            }
            when {
                day.savedByTrainer -> Text(stringResource(Res.string.tr_log_by_you), color = MaterialTheme.colorScheme.onSurfaceVariant)
                day.savedAt != null -> Text(stringResource(Res.string.tr_log_client_logged), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }

        item("voice") {
            TrainerPanel {
                Text(stringResource(Res.string.tr_log_voice_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(stringResource(Res.string.tr_log_voice_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = s.voiceText,
                    onValueChange = vm::onVoiceText,
                    label = { Text(stringResource(Res.string.tr_log_voice_label)) },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (vm.micAvailable) {
                        OutlinedButton(onClick = vm::dictate, enabled = !s.busy && !s.listening, modifier = Modifier.weight(1f)) {
                            Text(stringResource(if (s.listening) Res.string.tr_log_listening else Res.string.tr_log_speak), maxLines = 1)
                        }
                    } else if (vm.recordAvailable) {
                        OutlinedButton(onClick = vm::toggleRecording, enabled = !s.busy, modifier = Modifier.weight(1f)) {
                            Text(stringResource(if (s.recording) Res.string.tr_log_stop else Res.string.tr_log_speak), maxLines = 1)
                        }
                    }
                    Button(onClick = vm::suggest, enabled = !s.busy && s.voiceText.isNotBlank(), modifier = Modifier.weight(1f)) {
                        Text(stringResource(Res.string.tr_log_suggest), maxLines = 1)
                    }
                }
                if (voiceFirst && s.voiceText.isEmpty() && s.proposal == null) {
                    Text(stringResource(Res.string.tr_log_voice_example), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                s.proposal?.let { p -> ProposalBlock(p, busy = s.busy, onAddToForm = vm::applyWorkout, onApplyPlan = vm::applyPlan) }
            }
        }

        itemsIndexed(s.form, key = { i, e -> "ex:$i:${e.name}" }) { i, e ->
            TrainerPanel {
                Text(e.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                e.rows.forEachIndexed { r, set ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        when (e.metric) {
                            "time" -> NumberField(set.seconds, stringResource(Res.string.tr_log_seconds), e.hintReps, KeyboardType.Number, Modifier.weight(1f)) { vm.onCell(i, r, "seconds", it) }
                            "distance" -> NumberField(set.meters, stringResource(Res.string.tr_log_meters), e.hintReps, KeyboardType.Number, Modifier.weight(1f)) { vm.onCell(i, r, "meters", it) }
                            else -> {
                                NumberField(set.weight, stringResource(Res.string.tr_log_weight), e.hintWeight, KeyboardType.Decimal, Modifier.weight(1f)) { vm.onCell(i, r, "weight", it) }
                                NumberField(set.reps, stringResource(Res.string.tr_log_reps), e.hintReps, KeyboardType.Number, Modifier.weight(1f)) { vm.onCell(i, r, "reps", it) }
                            }
                        }
                    }
                }
                TextButton(onClick = { vm.onAddRow(i) }) { Text(stringResource(Res.string.tr_log_add_set)) }
            }
        }

        item("add-exercise") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = newExercise,
                    onValueChange = { newExercise = it.take(80) },
                    label = { Text(stringResource(Res.string.tr_log_add_exercise)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = { vm.onAddExercise(newExercise); newExercise = "" }, enabled = newExercise.isNotBlank()) { Text("+", maxLines = 1) }
            }
        }

        s.notice?.let { n ->
            item("notice") {
                val text = when (n) {
                    TrainerClientLogViewModel.Notice.Saved ->
                        stringResource(Res.string.tr_log_saved) + if (s.prs.isNotEmpty()) " 🏆 " + s.prs.joinToString(", ") else ""
                    TrainerClientLogViewModel.Notice.PlanApplied -> stringResource(Res.string.tr_log_plan_applied, s.applied.toString())
                    else -> stringResource(noticeText(n))
                }
                Text(text, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }

        item("save") {
            Button(onClick = vm::save, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (s.busy) Res.string.tr_log_saving else Res.string.tr_log_save), maxLines = 1)
            }
        }
    }
}

@Composable
private fun ProposalBlock(p: VoiceProposal, busy: Boolean, onAddToForm: () -> Unit, onApplyPlan: () -> Unit) {
    if (p.reply.isNotBlank()) Text(p.reply)
    when {
        p.kind == "workout" && p.entries.isNotEmpty() -> {
            Text(stringResource(Res.string.tr_log_proposal_workout), fontWeight = FontWeight.SemiBold)
            p.entries.forEach { e ->
                val sets = e.sets.joinToString(", ") { s ->
                    when {
                        (s.seconds ?: 0) > 0 && s.reps <= 0 -> "${s.seconds}s"
                        (s.meters ?: 0) > 0 -> "${s.meters} m"
                        else -> "${if (s.weight > 0) formatKg(s.weight) else "BW"}×${s.reps}"
                    }
                }
                Text("${e.name}: $sets", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = onAddToForm, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.tr_log_add_to_form), maxLines = 1) }
        }
        p.kind == "plan" && p.actions.isNotEmpty() -> {
            Text(stringResource(Res.string.tr_log_proposal_plan), fontWeight = FontWeight.SemiBold)
            p.actions.forEach { a -> Text("• ${a.label}", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Button(onClick = onApplyPlan, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.tr_log_apply_plan), maxLines = 1) }
        }
    }
}

private fun formatKg(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

@Composable
private fun NumberField(value: String, label: String, hint: String, type: KeyboardType, modifier: Modifier, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, maxLines = 1) },
        placeholder = { if (hint.isNotEmpty()) Text(hint, maxLines = 1) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = type),
        modifier = modifier,
    )
}

private fun noticeText(n: TrainerClientLogViewModel.Notice): StringResource = when (n) {
    TrainerClientLogViewModel.Notice.Saved -> Res.string.tr_log_saved
    TrainerClientLogViewModel.Notice.Stale -> Res.string.tr_log_stale
    TrainerClientLogViewModel.Notice.Nothing -> Res.string.tr_log_nothing
    TrainerClientLogViewModel.Notice.PlanApplied -> Res.string.tr_log_saved
    TrainerClientLogViewModel.Notice.PlanFailed -> Res.string.tr_log_plan_failed
    TrainerClientLogViewModel.Notice.PlanInjury -> Res.string.tr_log_plan_injury
    TrainerClientLogViewModel.Notice.SlowDown -> Res.string.tr_log_slow_down
    TrainerClientLogViewModel.Notice.Failed -> Res.string.tr_log_failed
    TrainerClientLogViewModel.Notice.SpeechEmpty -> Res.string.tr_log_speech_empty
    TrainerClientLogViewModel.Notice.NoMic -> Res.string.tr_log_no_mic
}
