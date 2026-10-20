package app.hacklimits.shared.trainer.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.roundToInt

/** The trainer's clients: requests, the client list, questions and the invite link. Opening a
 * client shows their card in place. The plan is the caller's screen ([onOpenClientPlan]). */
@Composable
fun TrainerClientsScreen(onBack: () -> Unit, onOpenClientPlan: (Long) -> Unit) {
    val vm: TrainerClientsViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val openId = s.cardId
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (openId != null) vm.closeCard() else onBack() }) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.trc_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        Feedback(s.error, s.notice)
        when {
            openId != null -> ClientCardView(s, vm, onOpenClientPlan)
            s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.error != null && s.clients.isEmpty() && s.invite == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
            }
            else -> ClientsList(s, vm, onOpenClientPlan)
        }
    }
}

@Composable
private fun Feedback(error: String?, notice: Notice?) {
    // Live regions so a screen reader announces the result of a tap without moving focus.
    error?.let {
        Text(
            stringResource(clientErrorText(it)), Modifier.padding(horizontal = 16.dp).semantics { liveRegion = LiveRegionMode.Polite },
            color = MaterialTheme.colorScheme.error,
        )
    }
    notice?.let {
        Text(
            stringResource(noticeText(it)), Modifier.padding(horizontal = 16.dp).semantics { liveRegion = LiveRegionMode.Polite },
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun ClientsList(s: TrainerClientsViewModel.State, vm: TrainerClientsViewModel, onOpenClientPlan: (Long) -> Unit) {
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { SectionTitle(Res.string.trc_requests_title) }
        if (s.requests.isEmpty()) item { Muted(Res.string.trc_requests_empty) }
        items(s.requests, key = { "req${it.id}" }) { request ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(request.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(request.note.ifBlank { stringResource(Res.string.trc_request_no_note) }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { vm.resolveRequest(request, accept = true) }, enabled = !s.busy) { Text(stringResource(Res.string.trc_accept)) }
                        OutlinedButton(onClick = { vm.resolveRequest(request, accept = false) }, enabled = !s.busy) { Text(stringResource(Res.string.trc_decline)) }
                    }
                }
            }
        }

        item { SectionTitle(Res.string.trc_clients_title) }
        if (s.clients.isEmpty()) item { Muted(Res.string.trc_clients_empty) }
        items(s.clients, key = { "client${it.id}" }) { client ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(client.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (client.flagged) Text(stringResource(Res.string.trc_flagged), color = MaterialTheme.colorScheme.primary)
                        if (client.atRisk) Text(stringResource(Res.string.trc_at_risk), color = MaterialTheme.colorScheme.error)
                    }
                    Text(
                        listOf(
                            stringResource(Res.string.trc_workouts_pct, "${client.workoutPct.roundToInt()}%"),
                            stringResource(Res.string.trc_nutrition_pct, "${client.nutritionPct.roundToInt()}%"),
                        ).joinToString(" · "),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        listOf(
                            stringResource(planText(client.plan)),
                            stringResource(if (client.onboarded) Res.string.trc_onboarded else Res.string.trc_not_onboarded),
                        ).joinToString(" · "),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row {
                        TextButton(onClick = { vm.openCard(client.id) }) { Text(stringResource(Res.string.trc_open_card)) }
                        TextButton(onClick = { onOpenClientPlan(client.id) }) { Text(stringResource(Res.string.trc_open_plan)) }
                    }
                }
            }
        }

        item { SectionTitle(Res.string.trc_questions_title) }
        if (s.questions.isEmpty()) item { Muted(Res.string.trc_questions_empty) }
        items(s.questions, key = { "question${it.id}" }) { question ->
            QuestionCard(question, enabled = !s.busy, onAnswer = { vm.answer(question, it) })
        }

        item { InviteSection(s, vm) }
    }
}

@Composable
private fun QuestionCard(question: TrainerQuestion, enabled: Boolean, onAnswer: (String) -> Unit) {
    // Not rememberSaveable: the text is client-supplied personal data and stays out of saved state.
    var text by remember(question.id) { mutableStateOf(question.draft) }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(question.client, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(question.text)
            if (question.status == "answered") {
                Text(stringResource(Res.string.trc_answered), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.take(2000) },
                        label = { Text(stringResource(Res.string.trc_answer_hint)) },
                        modifier = Modifier.weight(1f),
                    )
                    Button(onClick = { onAnswer(text.trim()) }, enabled = enabled && text.isNotBlank()) { Text(stringResource(Res.string.trc_send)) }
                }
            }
        }
    }
}

@Composable
private fun InviteSection(s: TrainerClientsViewModel.State, vm: TrainerClientsViewModel) {
    val invite = s.invite ?: return
    var name by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionTitle(Res.string.trc_invite_title)
        if (!invite.approved || invite.link.isEmpty()) {
            Muted(Res.string.trc_invite_not_approved)
        } else {
            Text(stringResource(Res.string.trc_invite_link), color = MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer { Text(invite.link, color = MaterialTheme.colorScheme.primary) }
        }
        Text(stringResource(Res.string.trc_invite_clients, invite.clients.toString()), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (invite.approved) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(60) },
                label = { Text(stringResource(Res.string.trc_invite_name)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { vm.createInvite(name) },
                enabled = !s.busy && name.trim().length >= 2,
            ) { Text(stringResource(Res.string.trc_invite_create)) }
        }
        if (invite.prospects.isNotEmpty()) {
            Text(stringResource(Res.string.trc_invite_prospects), color = MaterialTheme.colorScheme.onSurfaceVariant)
            invite.prospects.forEach { p ->
                SelectionContainer { Text("${p.name} · ${p.link}") }
            }
        }
    }
}

@Composable
private fun ClientCardView(s: TrainerClientsViewModel.State, vm: TrainerClientsViewModel, onOpenClientPlan: (Long) -> Unit) {
    val card = s.card
    if (card == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (s.cardLoading) {
                CircularProgressIndicator()
            } else {
                Button(onClick = { s.cardId?.let { vm.openCard(it) } }) { Text(stringResource(Res.string.retry)) }
            }
        }
        return
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(card.client.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        card.draft?.let { Text(stringResource(Res.string.trc_draft_line, it.days.toString(), it.exercises.toString()), color = MaterialTheme.colorScheme.primary) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.setFlag(!card.client.flagged) }, enabled = !s.busy) {
                Text(stringResource(if (card.client.flagged) Res.string.trc_flag_off else Res.string.trc_flag_on))
            }
            OutlinedButton(onClick = { onOpenClientPlan(card.client.id) }) { Text(stringResource(Res.string.trc_open_plan)) }
        }

        SectionTitle(Res.string.trc_body_title)
        val body = card.shared.body
        if (body == null) {
            Muted(Res.string.trc_not_shared)
        } else {
            Text(stringResource(Res.string.trc_body_line, number(body.heightCm), number(body.weightKg), number(body.goalWeight)))
        }

        SectionTitle(Res.string.trc_health_title)
        val health = card.shared.health
        if (health == null) {
            Muted(Res.string.trc_not_shared)
        } else {
            health.limitations?.takeIf { it.isNotBlank() }?.let { Text(stringResource(Res.string.trc_limitations, it)) }
            health.injuries.forEach { i ->
                Text(stringResource(Res.string.trc_injury_line, i.area, i.severity, i.since))
            }
        }

        CardFields(card, busy = s.busy, onSave = { h, p, b -> vm.saveCard(h, p, b) })
        NoteField(card, busy = s.busy, onSave = { vm.saveNote(it) })

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.requestPhoto() }, enabled = !s.busy) { Text(stringResource(Res.string.trc_request_photo)) }
            if (!card.client.onboarded) {
                OutlinedButton(onClick = { vm.nudgeInterview() }, enabled = !s.busy) { Text(stringResource(Res.string.trc_nudge)) }
            }
        }
    }
}

@Composable
private fun CardFields(card: ClientCard, busy: Boolean, onSave: (String, String, String) -> Unit) {
    // Not rememberSaveable: these notes are health and personal data and stay out of saved state.
    var health by remember(card.client.id) { mutableStateOf(card.card?.healthNotes.orEmpty()) }
    var personal by remember(card.client.id) { mutableStateOf(card.card?.personalNotes.orEmpty()) }
    var birthday by remember(card.client.id) { mutableStateOf(card.card?.birthday.orEmpty()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle(Res.string.trc_card_title)
        OutlinedTextField(value = health, onValueChange = { health = it.take(2000) }, label = { Text(stringResource(Res.string.trc_health_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = personal, onValueChange = { personal = it.take(2000) }, label = { Text(stringResource(Res.string.trc_personal_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            value = birthday,
            onValueChange = { birthday = it.take(10) },
            label = { Text(stringResource(Res.string.trc_birthday)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = { onSave(health, personal, birthday) }, enabled = !busy) { Text(stringResource(Res.string.trc_save_card)) }
    }
}

@Composable
private fun NoteField(card: ClientCard, busy: Boolean, onSave: (String) -> Unit) {
    var note by remember(card.client.id) { mutableStateOf(card.note.orEmpty()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle(Res.string.trc_note_title)
        OutlinedTextField(
            value = note,
            onValueChange = { note = it.take(2000) },
            label = { Text(stringResource(Res.string.trc_note_hint)) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = { onSave(note) }, enabled = !busy) { Text(stringResource(Res.string.trc_save_note)) }
    }
}

@Composable
private fun SectionTitle(res: StringResource) {
    Text(stringResource(res), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun Muted(res: StringResource) {
    Text(stringResource(res), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Whole numbers without a trailing ".0"; a value the client did not share reads as a dash. */
private fun number(value: Double?): String = when {
    value == null -> "-"
    value % 1.0 == 0.0 -> value.toLong().toString()
    else -> value.toString()
}

private fun planText(plan: String): StringResource = when (plan) {
    "active" -> Res.string.trc_plan_active
    "draft" -> Res.string.trc_plan_draft
    else -> Res.string.trc_plan_none
}

/** Client-specific codes first; anything else falls back to the shared sign-in text mapping. */
private fun clientErrorText(code: String): StringResource = when (code) {
    "not_found" -> Res.string.trc_err_not_found
    "forbidden" -> Res.string.trc_err_forbidden
    "validation_error" -> Res.string.trc_err_validation
    else -> errorText(code)
}

private fun noticeText(notice: Notice): StringResource = when (notice) {
    Notice.RequestAccepted -> Res.string.trc_notice_request_accepted
    Notice.RequestDeclined -> Res.string.trc_notice_request_declined
    Notice.Answered -> Res.string.trc_notice_answered
    Notice.Saved -> Res.string.trc_notice_saved
    Notice.FlagOn -> Res.string.trc_notice_flag_on
    Notice.FlagOff -> Res.string.trc_notice_flag_off
    Notice.PhotoRequested -> Res.string.trc_notice_photo_requested
    Notice.NudgeSent -> Res.string.trc_notice_nudge_sent
    Notice.NudgeNotNeeded -> Res.string.trc_notice_nudge_not_needed
    Notice.InviteCreated -> Res.string.trc_notice_invite_created
}
