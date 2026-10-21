package app.hacklimits.shared.trainingextras

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
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.round

/** Cardio: quick log of a type plus the typed time or distance, and the structured sessions with the user's zones. */
@Composable
fun CardioScreen(onBack: () -> Unit, vm: CardioViewModel = koinViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(s.saved) { if (s.saved) text = "" }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.tx_back)) }
        Text(stringResource(Res.string.tx_cardio_title), style = MaterialTheme.typography.headlineSmall)

        val cardio = s.cardio
        when {
            cardio == null && s.loading -> CircularProgressIndicator()
            cardio == null -> {
                Text(stringResource(errorText(s.loadError ?: "network")), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
            }
            else -> {
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(Res.string.tx_cardio_quick), style = MaterialTheme.typography.titleMedium)
                        cardio.quick.chunked(2).forEach { pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                pair.forEach { type ->
                                    FilledTonalButton(onClick = { vm.pick(type) }, modifier = Modifier.weight(1f)) { Text(type.label) }
                                }
                            }
                        }
                        s.picked?.let { type ->
                            OutlinedTextField(
                                value = text,
                                onValueChange = { text = it.take(120) },
                                label = { Text(stringResource(Res.string.tx_cardio_prompt, type.label)) },
                                placeholder = { Text(stringResource(Res.string.tx_cardio_placeholder)) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Button(onClick = { vm.log(text) }, enabled = !s.busy && text.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(Res.string.tx_cardio_log))
                            }
                        }
                        if (s.saved) Text(stringResource(Res.string.tx_cardio_saved))
                        if (s.unreadable) Text(stringResource(Res.string.tx_cardio_unreadable), color = MaterialTheme.colorScheme.error)
                        s.actionError?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) }
                    }
                }

                Text(stringResource(Res.string.tx_cardio_structured), style = MaterialTheme.typography.titleMedium)
                if (cardio.structured.intro.isNotBlank()) Text(cardio.structured.intro)
                cardio.structured.templates.forEach { tpl ->
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(stringResource(Res.string.tx_cardio_template, tpl.emoji, tpl.name, tpl.totalMin), style = MaterialTheme.typography.titleSmall)
                            tpl.steps.forEach { st ->
                                val rep = if (st.reps > 1) "${st.reps}× " else ""
                                Text(
                                    stringResource(
                                        Res.string.tx_cardio_step,
                                        rep, st.minutes, st.label, st.zone, st.bpm.lo, st.bpm.hi, cardio.bpmLabel,
                                    ),
                                )
                            }
                        }
                    }
                }
                if (cardio.structured.zoneNote.isNotBlank()) Text(cardio.structured.zoneNote, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Strength standards per big lift (bot: /std). Shown in the Progress train section. */
@Composable
fun StandardsCard(vm: StandardsViewModel = koinViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val standards = s.standards
    if (standards == null) return
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(Res.string.tx_standards_title), style = MaterialTheme.typography.titleMedium)
            when {
                standards.needsWeight -> Text(stringResource(Res.string.tx_standards_needs_weight), color = MaterialTheme.colorScheme.onSurfaceVariant)
                standards.lifts.isEmpty() -> Text(stringResource(Res.string.tx_standards_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> standards.lifts.forEach { lift ->
                    Column {
                        Text(stringResource(Res.string.tx_standards_lift, lift.exercise, lift.levelLabel), style = MaterialTheme.typography.titleSmall)
                        val ratio = round(lift.ratio * 100) / 100
                        Text(stringResource(Res.string.tx_standards_e1rm, lift.e1rm, ratio.toString()), style = MaterialTheme.typography.bodySmall)
                        val next = lift.nextLabel
                        val target = lift.nextTargetKg
                        if (next != null && target != null) {
                            Text(stringResource(Res.string.tx_standards_next, next, target), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            standards.bodyweight?.takeIf { !standards.needsWeight }?.let {
                Text(stringResource(Res.string.tx_standards_bodyweight, it), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * The post-vacation comeback interview: the server's questions one at a time, then the decision.
 * [onDone] runs when the person finishes (or when there is no comeback pending).
 */
@Composable
fun ComebackScreen(onBack: () -> Unit, onDone: () -> Unit, vm: ComebackViewModel = koinViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(s.index) { text = "" }
    LaunchedEffect(s.loading, s.pending) { if (!s.loading && s.loadError == null && !s.pending) onDone() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.tx_back)) }
        Text(stringResource(Res.string.tx_comeback_title), style = MaterialTheme.typography.headlineSmall)

        val result = s.result
        val current = s.current
        when {
            s.loading && s.steps.isEmpty() -> CircularProgressIndicator()
            s.loadError != null && s.steps.isEmpty() -> {
                Text(stringResource(errorText(s.loadError ?: "network")), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
            }
            result != null && result.decision == "adjust" -> AdaptiveCheckinCard(onDone)
            result != null -> {
                val message = when (result.decision) {
                    "recreate" -> Res.string.tx_comeback_done_recreate
                    else -> Res.string.tx_comeback_done_keep
                }
                Text(stringResource(message))
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.tx_comeback_done)) }
            }
            current != null -> {
                Text(
                    stringResource(Res.string.tx_comeback_progress, s.index + 1, s.steps.size),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(current.question, style = MaterialTheme.typography.titleMedium)
                if (current.kind == "text") {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.take(300) },
                        placeholder = { Text(stringResource(Res.string.tx_comeback_hint)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(onClick = { vm.answer(text.trim()) }, enabled = text.isNotBlank() && !s.busy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.tx_comeback_next))
                    }
                } else {
                    current.buttons.forEach { choice ->
                        FilledTonalButton(onClick = { vm.answer(choice.value) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                            Text(choice.label)
                        }
                    }
                }
                if (s.busy) CircularProgressIndicator()
                s.actionError?.let {
                    Text(stringResource(Res.string.tx_comeback_error), color = MaterialTheme.colorScheme.error)
                }
            }
            else -> CircularProgressIndicator()
        }
    }
}

/** The adaptive check-in after "adjust": one free-text answer; the coach replies and shows what it changed. */
@Composable
fun AdaptiveCheckinCard(onDone: () -> Unit, vm: AdaptiveCheckinViewModel = koinViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }

    Text(stringResource(Res.string.tx_adaptive_title), style = MaterialTheme.typography.titleMedium)
    val reply = s.reply
    if (reply != null) {
        Text(reply.reply)
        if (reply.adjustments.isEmpty()) {
            Text(stringResource(Res.string.tx_adaptive_none), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text(stringResource(Res.string.tx_adaptive_applied), color = MaterialTheme.colorScheme.onSurfaceVariant)
            reply.adjustments.forEach { Text("• $it") }
        }
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.tx_comeback_done)) }
        return
    }
    Text(stringResource(Res.string.tx_adaptive_prompt), color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
        value = text,
        onValueChange = { text = it.take(1000) },
        placeholder = { Text(stringResource(Res.string.tx_adaptive_placeholder)) },
        minLines = 3,
        modifier = Modifier.fillMaxWidth(),
    )
    Button(onClick = { vm.send(text.trim()) }, enabled = text.isNotBlank() && !s.busy, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(Res.string.tx_adaptive_send))
    }
    if (s.busy) CircularProgressIndicator()
    s.actionError?.let {
        Text(stringResource(Res.string.tx_adaptive_error), color = MaterialTheme.colorScheme.error)
    }
}
