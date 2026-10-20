package app.hacklimits.shared.trainer.clients

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.Button
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.roundToInt

/**
 * The trainer workspace: the client pulse with unread counts, requests, questions, the invite link
 * and first-client checklist, the at-risk report and one open client card (see TrainerClientCard).
 * The plan editor, chat and business screens are the caller's ([onOpenClientPlan], [onOpenChat],
 * [onOpenCoach], [onOpenBusiness]).
 */
@Composable
fun TrainerClientsScreen(
    onBack: () -> Unit,
    onOpenClientPlan: (Long) -> Unit,
    onOpenChat: (Long) -> Unit = {},
    onOpenCoach: () -> Unit = {},
    onOpenBusiness: () -> Unit = {},
) {
    val vm: TrainerClientsViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = {
                when {
                    s.cardId != null -> vm.closeCard()
                    s.showAtRisk -> vm.showAtRisk(false)
                    else -> onBack()
                }
            }) { Text(stringResource(Res.string.back)) }
        }
        when {
            s.cardId != null -> TrainerClientCard(s, vm, onOpenClientPlan, onOpenChat)
            s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.loadFailed -> LoadErrorPanel(onRetry = vm::load)
            s.showAtRisk -> AtRiskList(s, vm)
            else -> ClientsList(s, vm, onOpenClientPlan, onOpenCoach, onOpenBusiness)
        }
    }
}

@Composable
private fun ClientsList(
    s: TrainerClientsViewModel.State,
    vm: TrainerClientsViewModel,
    onOpenClientPlan: (Long) -> Unit,
    onOpenCoach: () -> Unit,
    onOpenBusiness: () -> Unit,
) {
    val inviteRequester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val progress = firstClientProgress(s.clients, s.invite?.prospects?.size ?: 0)
    val atRisk = s.clients.count { it.atRisk || it.flagged }

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item("header") {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(Res.string.tr_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(Res.string.tr_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text(stringResource(Res.string.tr_clients_count, s.clients.size.toString()), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        if (s.actionError) item("error") { ActionErrorNote(onDismiss = vm::dismissError) }
        item("tabs") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { OutlinedButton(onClick = { vm.showAtRisk(true) }) { Text(stringResource(Res.string.tr_tab_at_risk, atRisk.toString())) } }
                item { OutlinedButton(onClick = onOpenCoach) { Text(stringResource(Res.string.tr_tab_coach)) } }
                item { OutlinedButton(onClick = onOpenBusiness) { Text(stringResource(Res.string.tr_tab_profile)) } }
                item { OutlinedButton(onClick = onOpenBusiness) { Text(stringResource(Res.string.tr_tab_schedule)) } }
                item { OutlinedButton(onClick = onOpenBusiness) { Text(stringResource(Res.string.tr_tab_finance)) } }
            }
        }
        // No clients yet: inviting is the first job, so the invite leads; otherwise it follows the pulse.
        if (!s.checklistHidden && progress.next != null) item("checklist") {
            FirstClientChecklist(
                progress = progress,
                onInvite = { scope.launch { inviteRequester.bringIntoView() } },
                onOpenPlan = onOpenClientPlan,
                onHide = vm::hideChecklist,
            )
        }
        if (s.clients.isEmpty() && s.invite != null) item("invite-first") {
            InvitePanel(s, vm, Modifier.bringIntoViewRequester(inviteRequester))
        }

        item("pulse") {
            PanelHead(stringResource(Res.string.tr_pulse_eyebrow), stringResource(Res.string.tr_pulse_title))
        }
        items(s.clients, key = { "client${it.id}" }) { client ->
            ClientPulseRow(client, s.unread[client.id] ?: 0, vm)
        }

        if (s.clients.isNotEmpty() && s.invite != null) item("invite") {
            InvitePanel(s, vm, Modifier.bringIntoViewRequester(inviteRequester))
        }

        item("requests-head") {
            PanelHead(stringResource(Res.string.tr_requests_eyebrow), stringResource(Res.string.tr_requests_title), s.requests.size.toString())
        }
        if (s.requests.isEmpty()) item("requests-empty") { MutedText(stringResource(Res.string.tr_no_requests)) }
        items(s.requests, key = { "req${it.id}" }) { request ->
            TrainerPanel {
                Text(request.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                MutedText(request.note.ifBlank { stringResource(Res.string.tr_no_note) })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.resolveRequest(request, accept = true) }, enabled = s.busy == null) { Text(stringResource(Res.string.tr_accept)) }
                    OutlinedButton(onClick = { vm.resolveRequest(request, accept = false) }, enabled = s.busy == null) { Text(stringResource(Res.string.tr_decline)) }
                }
            }
        }

        item("questions-head") {
            val open = s.questions.count { it.status != "answered" }
            PanelHead(stringResource(Res.string.tr_questions_eyebrow), stringResource(Res.string.tr_questions_title), stringResource(Res.string.tr_open_count, open.toString()))
        }
        if (s.questions.isEmpty()) item("questions-empty") { MutedText(stringResource(Res.string.tr_questions_hint)) }
        items(s.questions, key = { "question${it.id}" }) { question ->
            QuestionCard(question, enabled = s.busy == null, onAnswer = { vm.answer(question, it) })
        }
    }
}

@Composable
private fun ClientPulseRow(client: ClientRow, unread: Int, vm: TrainerClientsViewModel) {
    TrainerPanel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(client.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                MutedText(stringResource(Res.string.tr_client_pcts, client.workoutPct.roundToInt().toString(), client.nutritionPct.roundToInt().toString()))
            }
            if (unread > 0) {
                val unreadLabel = stringResource(Res.string.tr_chat_unread)
                Text(
                    "• $unread",
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.semantics { contentDescription = unreadLabel }.padding(end = 6.dp),
                )
            }
            StatusLabel(client.flagged, client.atRisk)
        }
        TextButton(onClick = { vm.openCard(client.id) }) { Text(stringResource(Res.string.tr_open_client)) }
    }
}

/** The status signal the web shows: flagged wins over at-risk, and on-track is the default. */
@Composable
internal fun StatusLabel(flagged: Boolean, atRisk: Boolean) {
    when {
        flagged -> AttentionText(stringResource(Res.string.tr_flagged))
        atRisk -> AttentionText(stringResource(Res.string.tr_at_risk))
        else -> Text(stringResource(Res.string.tr_on_track), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AtRiskList(s: TrainerClientsViewModel.State, vm: TrainerClientsViewModel) {
    val clients = s.clients.filter { it.atRisk || it.flagged }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item("head") {
            PanelHead(stringResource(Res.string.tr_atrisk_eyebrow), stringResource(Res.string.tr_atrisk_title, clients.size.toString()))
        }
        if (clients.isEmpty()) item("empty") { MutedText(stringResource(Res.string.tr_atrisk_empty)) }
        items(clients, key = { "risk${it.id}" }) { client ->
            TrainerPanel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(client.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        MutedText(stringResource(Res.string.tr_client_pcts, client.workoutPct.roundToInt().toString(), client.nutritionPct.roundToInt().toString()))
                        client.missedDates?.takeIf { it.size >= 2 }?.let {
                            MutedText(stringResource(Res.string.tr_atrisk_missed, shortDate(it[0]), shortDate(it[1])))
                        }
                    }
                    StatusLabel(client.flagged, client.atRisk)
                }
                TextButton(onClick = { vm.openCard(client.id) }) { Text(stringResource(Res.string.tr_open_client)) }
            }
        }
    }
}

@Composable
private fun FirstClientChecklist(
    progress: FirstClientProgress,
    onInvite: () -> Unit,
    onOpenPlan: (Long) -> Unit,
    onHide: () -> Unit,
) {
    val steps = FirstClientStep.entries
    TrainerPanel {
        PanelHead(
            stringResource(Res.string.tr_fc_eyebrow),
            stringResource(Res.string.tr_fc_title),
            "${progress.done.size}/${steps.size}",
        )
        steps.forEach { step ->
            val isNext = step == progress.next
            val done = step in progress.done
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (done) "✓" else "○", color = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                Column(Modifier.weight(1f)) {
                    Text(stringResource(stepTitle(step)), fontWeight = if (isNext) FontWeight.SemiBold else FontWeight.Normal)
                    if (isNext) MutedText(stringResource(stepHint(step)))
                    if (isNext && step == FirstClientStep.Invite) TextButton(onClick = onInvite) { Text(stringResource(Res.string.tr_fc_invite_btn)) }
                    if (isNext && step == FirstClientStep.Assigned) progress.draftClientId?.let { id ->
                        TextButton(onClick = { onOpenPlan(id) }) { Text(stringResource(Res.string.tr_fc_review_btn)) }
                    }
                }
            }
        }
        TextButton(onClick = onHide) { Text(stringResource(Res.string.tr_fc_hide)) }
    }
}

private fun stepTitle(step: FirstClientStep) = when (step) {
    FirstClientStep.Invite -> Res.string.tr_fc_invite
    FirstClientStep.Joined -> Res.string.tr_fc_joined
    FirstClientStep.Intake -> Res.string.tr_fc_intake
    FirstClientStep.Assigned -> Res.string.tr_fc_assigned
}

private fun stepHint(step: FirstClientStep) = when (step) {
    FirstClientStep.Invite -> Res.string.tr_fc_invite_hint
    FirstClientStep.Joined -> Res.string.tr_fc_joined_hint
    FirstClientStep.Intake -> Res.string.tr_fc_intake_hint
    FirstClientStep.Assigned -> Res.string.tr_fc_assigned_hint
}

@Composable
private fun QuestionCard(question: TrainerQuestion, enabled: Boolean, onAnswer: (String) -> Unit) {
    // Not rememberSaveable: the question text is client-supplied personal data and stays out of saved state.
    var text by remember(question.id) { mutableStateOf(question.draft) }
    TrainerPanel {
        Text(question.client, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(question.text)
        if (question.status == "answered") {
            MutedText(stringResource(Res.string.tr_answered))
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text(stringResource(Res.string.tr_answer_ph)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(onClick = { onAnswer(text.trim()) }, enabled = enabled && text.isNotBlank()) { Text(stringResource(Res.string.tr_send)) }
            }
        }
    }
}

/** The invite panel: the shareable profile link, and single-use personal invites for a named person. */
@Composable
private fun InvitePanel(s: TrainerClientsViewModel.State, vm: TrainerClientsViewModel, modifier: Modifier) {
    val invite = s.invite ?: return
    var name by remember { mutableStateOf("") }
    val full = invite.maxClients != null && invite.clients >= invite.maxClients
    TrainerPanel(modifier) {
        PanelHead(
            stringResource(Res.string.tr_invite_eyebrow),
            stringResource(Res.string.tr_invite_title),
            invite.maxClients?.let { "${invite.clients}/$it" } ?: invite.clients.toString(),
        )
        when {
            !invite.approved -> MutedText(stringResource(Res.string.tr_invite_pending))
            invite.link.isBlank() -> MutedText(stringResource(Res.string.tr_invite_no_bot))
            else -> {
                Text(stringResource(Res.string.tr_invite_body))
                if (!invite.accepting || full) MutedText(stringResource(if (full) Res.string.tr_invite_full else Res.string.tr_invite_closed))
                LinkRow(invite.link, invite.shareText)

                Text(stringResource(Res.string.tr_invite_personal_title), fontWeight = FontWeight.SemiBold)
                MutedText(stringResource(Res.string.tr_invite_personal_body))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it.take(60) },
                        placeholder = { Text(stringResource(Res.string.tr_invite_name_ph)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { vm.createInvite(name); name = "" },
                        enabled = s.busy == null && name.trim().length >= 2,
                    ) { Text(stringResource(Res.string.tr_invite_create)) }
                }
                s.freshInvite?.let { fresh ->
                    Text(fresh.name, fontWeight = FontWeight.SemiBold)
                    LinkRow(fresh.link, stringResource(Res.string.tr_invite_personal_text, fresh.name))
                }
                val waiting = invite.prospects.filter { it.link != s.freshInvite?.link }
                if (waiting.isNotEmpty()) {
                    MutedText(stringResource(Res.string.tr_invite_waiting))
                    waiting.forEach { prospect ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(prospect.name, modifier = Modifier.weight(1f))
                            ShareButton(prospect.link, stringResource(Res.string.tr_invite_personal_text, prospect.name))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LinkRow(link: String, shareText: String) {
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var copied by remember(link) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2500)
            copied = false
        }
    }
    OutlinedTextField(
        value = link,
        onValueChange = {},
        readOnly = true,
        singleLine = true,
        label = { Text(stringResource(Res.string.tr_invite_link_label)) },
        modifier = Modifier.fillMaxWidth(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ShareButton(link, shareText, primary = true)
        OutlinedButton(onClick = {
            scope.launch {
                clipboard.setText(AnnotatedString(link))
                copied = true
            }
        }) { Text(stringResource(if (copied) Res.string.tr_copied else Res.string.tr_copy)) }
    }
}

@Composable
private fun ShareButton(link: String, text: String, primary: Boolean = false) {
    val uriHandler = LocalUriHandler.current
    val onClick = { uriHandler.openUri("https://t.me/share/url?url=${link.encodeURLParameter()}&text=${text.encodeURLParameter()}") }
    if (primary) Button(onClick = onClick) { Text(stringResource(Res.string.tr_share)) }
    else TextButton(onClick = onClick) { Text(stringResource(Res.string.tr_share)) }
}
