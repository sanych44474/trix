package app.hacklimits.shared.programs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

private const val PREVIEW = 4
private val PLACES = listOf("gym", "dumbbells", "bodyweight")
private val LEVELS = listOf("beginner", "intermediate", "advanced")
private val AUDIENCES = listOf("any", "women", "men")

/**
 * Ready programs and the shared program library. [onApplied] runs after a program became the plan
 * (onboarding leaves the questionnaire then; the plan screen reloads).
 */
@Composable
fun ProgramsScreen(vm: ProgramsViewModel, onBack: () -> Unit, onApplied: () -> Unit = {}) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.pl_nav_more)) }
        Text(stringResource(Res.string.pg_rp_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.pg_rp_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(stringResource(Res.string.pg_rp_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
        ReadyProgramsSection(vm, onApplied)
        SharedLibrarySection(vm)
    }
}

/** Filters, the program list and the apply flow. Reused by the onboarding's ready-program path. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReadyProgramsSection(vm: ProgramsViewModel, onApplied: () -> Unit = {}) {
    val s by vm.state.collectAsStateWithLifecycle()
    val programs = s.programs
    when {
        s.failed -> {
            Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
            Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
            return
        }
        programs == null -> {
            Text("…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return
        }
    }
    val client = s.role == "client"
    val shown = vm.visible(s)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            PLACES.forEach { p ->
                FilterChip(selected = s.place == p, onClick = { vm.setPlace(p) }, label = { Text(stringResource(placeLabel(p))) })
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AUDIENCES.forEach { a ->
                FilterChip(selected = s.audience == a, onClick = { vm.setAudience(a) }, label = { Text(stringResource(audienceLabel(a))) })
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            (listOf("any") + LEVELS).forEach { l ->
                FilterChip(selected = s.level == l, onClick = { vm.setLevel(l) }, label = { Text(stringResource(levelFilterLabel(l))) })
            }
        }
        if (client) Text(stringResource(Res.string.pg_rp_trainer_managed), color = MaterialTheme.colorScheme.onSurfaceVariant)

        (if (s.showAll) shown else shown.take(PREVIEW)).forEach { p ->
            val open = s.open == p.id
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        Modifier.fillMaxWidth().clickable { vm.toggleOpen(p.id) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name, fontWeight = FontWeight.SemiBold)
                            Text(
                                stringResource(Res.string.pg_rp_meta, p.daysPerWeek, p.minutes) + " · " + stringResource(audienceLabel(if (p.audience == "all") "any" else p.audience)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(stringResource(levelFilterLabel(p.level)), color = MaterialTheme.colorScheme.primary)
                    }
                    if (open) {
                        Text(p.summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        p.days.forEachIndexed { i, day ->
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(stringResource(Res.string.pg_rp_day_n, i + 1) + " · " + day.title, fontWeight = FontWeight.SemiBold)
                                day.exercises.forEach { e -> Text("${e.name} — ${e.sets}", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                        if (!client) {
                            if (s.confirm == p.id) {
                                Button(onClick = { vm.apply(p, onApplied) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(if (s.busy) Res.string.pl_saving_ellipsis else Res.string.pg_rp_apply_confirm))
                                }
                                TextButton(onClick = { vm.askConfirm(null) }, enabled = !s.busy) { Text(stringResource(Res.string.pl_close)) }
                                Text(stringResource(Res.string.pg_rp_apply_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                OutlinedButton(onClick = { vm.askConfirm(p.id) }, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(Res.string.pg_rp_apply_btn))
                                }
                            }
                        }
                    }
                }
            }
        }
        if (!s.showAll && shown.size > PREVIEW) {
            TextButton(onClick = vm::showAll) { Text(stringResource(Res.string.pg_rp_show_all, shown.size)) }
        }
        noteText(s.note)?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
    }
}

@Composable
private fun SharedLibrarySection(vm: ProgramsViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(Res.string.pg_library_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        val shared = s.shared
        when {
            s.sharedFailed -> {
                Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::loadShared) { Text(stringResource(Res.string.retry)) }
            }
            shared == null -> Text("…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            shared.isEmpty() -> Column {
                Text(stringResource(Res.string.pg_library_empty_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(Res.string.pg_library_empty_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> shared.forEach { p ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(Res.string.pg_library_taken_count, p.takenCount), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (s.role != "client") {
                        OutlinedButton(onClick = { vm.take(p) }, enabled = s.takingCode == null) {
                            Text(stringResource(if (s.takingCode == p.code) Res.string.pl_saving_ellipsis else Res.string.pg_library_take_btn))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun noteText(note: ProgramNote?): String? = when (note) {
    null -> null
    is ProgramNote.Applied -> stringResource(Res.string.pg_rp_applied, note.name)
    is ProgramNote.Taken -> stringResource(Res.string.pg_library_taken_note, note.name)
    ProgramNote.TrainerManaged -> stringResource(Res.string.pg_rp_trainer_managed)
    ProgramNote.Error -> stringResource(Res.string.pl_generic_error)
}

private fun placeLabel(place: String): StringResource = when (place) {
    "dumbbells" -> Res.string.pg_rp_place_dumbbells
    "bodyweight" -> Res.string.pg_rp_place_bodyweight
    else -> Res.string.pg_rp_place_gym
}

private fun audienceLabel(audience: String): StringResource = when (audience) {
    "women" -> Res.string.pg_rp_aud_women
    "men" -> Res.string.pg_rp_aud_men
    else -> Res.string.pg_rp_aud_any
}

private fun levelFilterLabel(level: String): StringResource = when (level) {
    "beginner" -> Res.string.pg_rp_level_beginner
    "intermediate" -> Res.string.pg_rp_level_intermediate
    "advanced" -> Res.string.pg_rp_level_advanced
    else -> Res.string.pg_rp_level_any
}
