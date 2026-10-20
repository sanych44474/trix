package app.hacklimits.shared.trainer.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil3.compose.LocalPlatformContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import kotlin.math.roundToInt
import org.jetbrains.compose.resources.stringResource

/** The client card: the readiness and draft at the top, then notes, the coach note and its history, the
 * client's shared body and health data, progress photos and template creation. */
@Composable
internal fun TrainerClientCard(
    s: TrainerClientsViewModel.State,
    vm: TrainerClientsViewModel,
    onOpenClientPlan: (Long) -> Unit,
    onOpenChat: (Long) -> Unit,
) {
    val card = s.card
    when {
        s.cardFailed -> LoadErrorPanel(onRetry = vm::retryCard)
        card == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else -> CardBody(s, card, vm, onOpenClientPlan, onOpenChat)
    }
}

@Composable
private fun CardBody(
    s: TrainerClientsViewModel.State,
    card: ClientCard,
    vm: TrainerClientsViewModel,
    onOpenClientPlan: (Long) -> Unit,
    onOpenChat: (Long) -> Unit,
) {
    val id = card.client.id
    val idle = s.busy == null
    // Form state survives a card reload (after a draft decision), and resets only for another client.
    var healthNotes by remember(id) { mutableStateOf(card.card?.healthNotes.orEmpty()) }
    var personalNotes by remember(id) { mutableStateOf(card.card?.personalNotes.orEmpty()) }
    var birthday by remember(id) { mutableStateOf(card.card?.birthday.orEmpty()) }
    var coachNote by remember(id) { mutableStateOf(card.note.orEmpty()) }
    var templateName by remember(id) { mutableStateOf("") }
    LaunchedEffect(s.notice) { if (s.notice == Notice.TemplateCreated) templateName = "" }

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item("title") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(Res.string.tr_card_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(card.client.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                OutlinedButton(onClick = { onOpenClientPlan(id) }) { Text(stringResource(Res.string.tr_edit_plan)) }
            }
        }
        if (s.actionError) item("error") { ActionErrorNote(onDismiss = vm::dismissError) }

        // A plan draft waiting for the trainer comes first, with one unmistakable action.
        card.draft?.let { draft ->
            item("draft") {
                DraftPanel(draft, busy = s.busy, idle = idle, notice = s.notice, onOpenPlan = { onOpenClientPlan(id) }, onDecide = vm::decideDraft)
            }
        }

        item("readiness") {
            val flagged = card.client.flagged
            TrainerPanel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(Res.string.tr_readiness_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(stringResource(recoveryLabel(card.dashboard?.recovery?.label)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                    if (flagged) AttentionText(stringResource(Res.string.tr_flagged)) else MutedText(stringResource(Res.string.tr_on_track))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    card.dashboard?.recovery?.let { Metric(stringResource(Res.string.tr_metric_recovery), it.score.roundToInt().toString()) }
                    card.dashboard?.gamification?.let { g ->
                        Metric(
                            stringResource(Res.string.tr_metric_streak),
                            stringResource(Res.string.tr_streak_weeks, (g.streak ?: 0).toString()),
                            stringResource(Res.string.tr_level, g.level.toString()),
                        )
                    }
                }
                card.cycle?.let { MutedText(stringResource(Res.string.tr_cycle, it.phase, it.day.toString())) }
                OutlinedButton(onClick = { vm.setFlag(!flagged) }, enabled = idle) {
                    Text(stringResource(if (flagged) Res.string.tr_unflag else Res.string.tr_flag))
                }
            }
        }

        if (!card.client.onboarded) item("nudge") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_nudge_eyebrow), stringResource(Res.string.tr_nudge_title))
                OutlinedButton(onClick = { vm.nudgeInterview() }, enabled = idle) {
                    Text(stringResource(if (s.busy == "interview") Res.string.tr_saving else Res.string.tr_nudge_btn))
                }
                if (s.notice == Notice.NudgeSent) NoticeText(stringResource(Res.string.tr_nudge_sent))
            }
        }

        item("notes") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_notes_eyebrow), stringResource(Res.string.tr_notes_title))
                OutlinedTextField(
                    value = birthday,
                    onValueChange = { birthday = it.take(10) },
                    label = { Text(stringResource(Res.string.tr_birthday)) },
                    placeholder = { Text(stringResource(Res.string.tr_birthday_ph)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = healthNotes,
                    onValueChange = { healthNotes = it.take(2000) },
                    label = { Text(stringResource(Res.string.tr_health_notes)) },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = personalNotes,
                    onValueChange = { personalNotes = it.take(2000) },
                    label = { Text(stringResource(Res.string.tr_personal_notes)) },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (s.notice == Notice.CardSaved) NoticeText(stringResource(Res.string.tr_saved))
                Button(onClick = { vm.saveCard(healthNotes, personalNotes, birthday) }, enabled = idle) {
                    Text(stringResource(if (s.busy == "card") Res.string.tr_saving else Res.string.tr_save_card))
                }
            }
        }

        item("coach-note") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_coach_note_eyebrow), stringResource(Res.string.tr_coach_note_title))
                OutlinedTextField(
                    value = coachNote,
                    onValueChange = { coachNote = it.take(2000) },
                    placeholder = { Text(stringResource(Res.string.tr_coach_note_ph)) },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (s.notice == Notice.NoteSaved) NoticeText(stringResource(Res.string.tr_saved))
                OutlinedButton(onClick = { vm.saveNote(coachNote) }, enabled = idle) {
                    Text(stringResource(if (s.busy == "note") Res.string.tr_saving else Res.string.tr_save_note))
                }
            }
        }

        item("history") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_history_eyebrow), stringResource(Res.string.tr_history_title))
                if (card.noteHistory.isEmpty()) MutedText(stringResource(Res.string.tr_history_empty))
                card.noteHistory.forEach { entry ->
                    Column {
                        Text(noteFieldLabel(entry.field), fontWeight = FontWeight.SemiBold)
                        MutedText(entry.savedAt.take(16).replace('T', ' '))
                        Text(entry.value)
                    }
                }
            }
        }

        item("thread") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_thread_eyebrow), stringResource(Res.string.tr_thread_title))
                Button(onClick = { onOpenChat(id) }) { Text(stringResource(Res.string.tr_open_chat)) }
            }
        }

        card.shared.body?.let { body ->
            item("body") {
                TrainerPanel {
                    PanelHead(stringResource(Res.string.tr_body_eyebrow), stringResource(Res.string.tr_body_title))
                    Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        body.heightCm?.let { Metric(stringResource(Res.string.tr_height), "${formatNumber(it)} cm") }
                        body.weightKg?.let { Metric(stringResource(Res.string.tr_weight), "${formatNumber(it)} kg") }
                        body.age?.let { Metric(stringResource(Res.string.tr_age), formatNumber(it)) }
                    }
                }
            }
        }

        card.shared.health?.let { health ->
            item("health") {
                TrainerPanel {
                    PanelHead(stringResource(Res.string.tr_health_eyebrow), stringResource(Res.string.tr_health_title))
                    health.limitations?.let { MutedText(it) }
                    if (health.injuries.isEmpty()) MutedText(stringResource(Res.string.tr_no_blockers))
                    health.injuries.forEach { injury ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(areaLabel(injury.area)), fontWeight = FontWeight.SemiBold)
                                MutedText(stringResource(Res.string.tr_since, injury.since))
                            }
                            Text(stringResource(severityLabel(injury.severity)))
                        }
                    }
                }
            }
        }

        item("photos") {
            val photos = card.photos.orEmpty()
            TrainerPanel {
                PanelHead(
                    stringResource(Res.string.tr_photos_eyebrow),
                    stringResource(Res.string.tr_photos_title),
                    if (photos.isNotEmpty()) photos.size.toString() else null,
                )
                if (photos.isEmpty()) {
                    MutedText(stringResource(Res.string.tr_photos_empty))
                } else {
                    PhotoStrip(photos, s.photoBearer, vm)
                }
                OutlinedButton(onClick = { vm.requestPhoto() }, enabled = idle) {
                    Text(stringResource(if (s.busy == "photoreq") Res.string.tr_saving else Res.string.tr_request_photos))
                }
                if (s.notice == Notice.PhotoRequested) NoticeText(stringResource(Res.string.tr_photos_sent))
            }
        }

        item("template") {
            TrainerPanel {
                PanelHead(stringResource(Res.string.tr_tpl_eyebrow), stringResource(Res.string.tr_tpl_create_title))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = templateName,
                        onValueChange = { templateName = it.take(60) },
                        placeholder = { Text(stringResource(Res.string.tr_tpl_name_ph)) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        onClick = { vm.createTemplate(templateName) },
                        enabled = idle && templateName.isNotBlank(),
                    ) { Text(stringResource(if (s.busy == "template") Res.string.tr_saving else Res.string.tr_tpl_create)) }
                }
                if (s.notice == Notice.TemplateCreated) NoticeText(stringResource(Res.string.tr_tpl_created))
                if (s.templateNoPlan) AttentionText(stringResource(Res.string.tr_no_plan))
            }
        }
    }
}

@Composable
private fun DraftPanel(
    draft: ClientCard.Draft,
    busy: String?,
    idle: Boolean,
    notice: Notice?,
    onOpenPlan: () -> Unit,
    onDecide: (String) -> Unit,
) {
    var confirmDiscard by remember { mutableStateOf(false) }
    TrainerPanel {
        Text(stringResource(Res.string.tr_draft_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text(stringResource(Res.string.tr_draft_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        MutedText(stringResource(Res.string.tr_draft_meta, draft.days.toString(), draft.exercises.toString(), shortDate(draft.createdAt)))
        draft.autoActivatesAt?.let {
            MutedText(stringResource(if (draft.postponed) Res.string.tr_draft_postponed else Res.string.tr_draft_auto, shortDate(it)))
        }
        Button(onClick = { onDecide("assign") }, enabled = idle, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (busy == "draft") Res.string.tr_saving else Res.string.tr_draft_assign))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = onOpenPlan) { Text(stringResource(Res.string.tr_draft_view)) }
            if (draft.autoActivatesAt != null && !draft.postponed) {
                TextButton(onClick = { onDecide("postpone") }, enabled = idle) { Text(stringResource(Res.string.tr_draft_postpone)) }
            }
            TextButton(onClick = { confirmDiscard = true }, enabled = idle) { Text(stringResource(Res.string.tr_draft_discard)) }
        }
        if (notice == Notice.DraftDone) NoticeText(stringResource(Res.string.tr_draft_done))
    }
    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            text = { Text(stringResource(Res.string.tr_draft_discard_confirm)) },
            confirmButton = {
                TextButton(onClick = { confirmDiscard = false; onDecide("discard") }) { Text(stringResource(Res.string.tr_draft_discard)) }
            },
            dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text(stringResource(Res.string.tr_close)) } },
        )
    }
}

@Composable
private fun Metric(label: String, value: String, detail: String? = null) {
    Column {
        MutedText(label)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        detail?.let { MutedText(it) }
    }
}

@Composable
private fun PhotoStrip(photos: List<ClientCard.Photo>, bearer: String?, vm: TrainerClientsViewModel) {
    val context = LocalPlatformContext.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(photos, key = { it.id }) { photo ->
            Column {
                AsyncImage(
                    model = ImageRequest.Builder(context)
                        .data(vm.photoUrl(photo.id))
                        .httpHeaders(NetworkHeaders.Builder().apply { bearer?.let { set("Authorization", it) } }.build())
                        .build(),
                    contentDescription = stringResource(Res.string.tr_photo_alt, photo.takenAt),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.height(140.dp).aspectRatio(0.75f).clip(RoundedCornerShape(10.dp)),
                )
                MutedText(photo.takenAt)
            }
        }
    }
}

private fun recoveryLabel(label: String?) = when (label) {
    "great" -> Res.string.tr_recovery_great
    "good" -> Res.string.tr_recovery_good
    "poor" -> Res.string.tr_recovery_poor
    else -> Res.string.tr_recovery_fair
}

private fun areaLabel(area: String) = when (area) {
    "shoulder" -> Res.string.tr_inj_area_shoulder
    "elbow" -> Res.string.tr_inj_area_elbow
    "wrist" -> Res.string.tr_inj_area_wrist
    "lower_back" -> Res.string.tr_inj_area_lower_back
    "knee" -> Res.string.tr_inj_area_knee
    "hip" -> Res.string.tr_inj_area_hip
    "ankle" -> Res.string.tr_inj_area_ankle
    else -> Res.string.tr_inj_area_neck
}

private fun severityLabel(severity: String) = when (severity) {
    "strong" -> Res.string.tr_inj_sev_strong
    else -> Res.string.tr_inj_sev_mild
}

/** Field keys the note history stores, shown with the same labels as the editable fields. */
@Composable
private fun noteFieldLabel(field: String): String = when (field) {
    "healthNotes" -> stringResource(Res.string.tr_health_notes)
    "personalNotes" -> stringResource(Res.string.tr_personal_notes)
    "note" -> stringResource(Res.string.tr_coach_note_title)
    else -> field
}

/** 62.0 reads as "62", 62.5 as "62.5". */
private fun formatNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
