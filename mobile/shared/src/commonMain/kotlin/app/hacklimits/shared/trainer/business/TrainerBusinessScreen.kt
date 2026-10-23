package app.hacklimits.shared.trainer.business

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/** Trainer business: profile, sessions, finance, plan templates and broadcast, one tab each. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainerBusinessScreen(onBack: () -> Unit) {
    val vm: TrainerBusinessViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val sections = TrainerBusinessViewModel.Section.entries
    val clients = s.sessions?.clients ?: emptyList()
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.trb_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        ScrollableTabRow(selectedTabIndex = sections.indexOf(s.section), edgePadding = 12.dp) {
            sections.forEach { section ->
                Tab(
                    selected = section == s.section,
                    onClick = { vm.select(section) },
                    text = { Text(stringResource(sectionName(section))) },
                )
            }
        }
        // Errors and confirmations share one polite live region so a screen reader announces the outcome of a tap.
        Column(Modifier.padding(horizontal = 16.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
            s.error?.let { Text(stringResource(businessErrorText(it)), color = MaterialTheme.colorScheme.error) }
            s.notice?.let { Text(noticeText(it, s.noticeCount), color = MaterialTheme.colorScheme.primary) }
        }
        when (s.section) {
            TrainerBusinessViewModel.Section.PROFILE -> ProfileSection(
                state = s.profile,
                busy = s.busy,
                onRetry = { vm.select(s.section) },
                onSave = vm::saveProfile,
                modifier = Modifier.weight(1f),
            )
            TrainerBusinessViewModel.Section.SESSIONS -> SessionsSection(
                data = s.sessions,
                busy = s.busy,
                onRetry = { vm.select(s.section) },
                onAdd = vm::addSession,
                onStatus = vm::setSessionStatus,
                onDelete = vm::deleteSession,
                modifier = Modifier.weight(1f),
            )
            TrainerBusinessViewModel.Section.FINANCE -> FinanceSection(
                data = s.finance,
                busy = s.busy,
                onRetry = { vm.select(s.section) },
                onRecord = vm::recordPayment,
                onDeletePayment = vm::deletePayment,
                modifier = Modifier.weight(1f),
            )
            TrainerBusinessViewModel.Section.TEMPLATES -> TemplatesSection(
                templates = s.templates,
                clients = clients,
                busy = s.busy,
                onRetry = { vm.select(s.section) },
                onCreate = vm::createTemplate,
                onAssign = vm::assignTemplate,
                onDelete = vm::deleteTemplate,
                modifier = Modifier.weight(1f),
            )
            TrainerBusinessViewModel.Section.BROADCAST -> BroadcastSection(
                clientCount = s.sessions?.clients?.size,
                busy = s.busy,
                onSend = vm::broadcast,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun ProfileSection(
    state: ProfileResult?,
    busy: Boolean,
    onRetry: () -> Unit,
    onSave: (ProfilePatch, Boolean) -> Unit,
    modifier: Modifier,
) {
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val trainer = state?.trainer
        when {
            state == null -> item { LoadingOrRetry(busy, onRetry) }
            trainer == null -> {
                item { Text(stringResource(Res.string.trb_profile_apply_intro)) }
                item { ProfileForm(null, busy, isNew = true, onSave = onSave) }
            }
            else -> {
                item {
                    Text(stringResource(profileStatusName(trainer.status)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(Res.string.trb_profile_clients, trainer.clients), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item { ProfileForm(trainer, busy, isNew = false, onSave = onSave) }
            }
        }
    }
}

@Composable
private fun ProfileForm(
    trainer: TrainerProfile?,
    busy: Boolean,
    isNew: Boolean,
    onSave: (ProfilePatch, Boolean) -> Unit,
) {
    var name by remember(trainer) { mutableStateOf(trainer?.name.orEmpty()) }
    var bio by remember(trainer) { mutableStateOf(trainer?.bio.orEmpty()) }
    var specialization by remember(trainer) { mutableStateOf(trainer?.specialization.orEmpty()) }
    var approach by remember(trainer) { mutableStateOf(trainer?.approach.orEmpty()) }
    var city by remember(trainer) { mutableStateOf(trainer?.city.orEmpty()) }
    var contact by remember(trainer) { mutableStateOf(trainer?.contact.orEmpty()) }
    var experience by remember(trainer) { mutableStateOf(trainer?.experienceYears?.toString().orEmpty()) }
    var price by remember(trainer) { mutableStateOf(trainer?.priceOnline?.let { formatAmount(it) }.orEmpty()) }
    var accepting by remember(trainer) { mutableStateOf(trainer?.accepting ?: false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(name, { name = it.take(60) }, label = { Text(stringResource(Res.string.trb_profile_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(bio, { bio = it.take(600) }, label = { Text(stringResource(Res.string.trb_profile_bio)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(specialization, { specialization = it.take(120) }, label = { Text(stringResource(Res.string.trb_profile_specialization)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(approach, { approach = it.take(600) }, label = { Text(stringResource(Res.string.trb_profile_approach)) }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(city, { city = it.take(60) }, label = { Text(stringResource(Res.string.trb_profile_city)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(contact, { contact = it.take(120) }, label = { Text(stringResource(Res.string.trb_profile_contact)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            experience,
            { experience = it.filter(Char::isDigit).take(2) },
            label = { Text(stringResource(Res.string.trb_profile_experience)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        // The server has no currency on the profile, so the price is shown as a bare number.
        OutlinedTextField(
            price,
            { price = it.filter(Char::isDigit).take(7) },
            label = { Text(stringResource(Res.string.trb_profile_price)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (!isNew) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(Res.string.trb_profile_accepting), Modifier.weight(1f))
                Switch(checked = accepting, onCheckedChange = { accepting = it })
            }
        }
        Button(
            onClick = {
                onSave(
                    ProfilePatch(
                        name = name.trim(),
                        bio = bio.trim(),
                        specialization = specialization.trim(),
                        approach = approach.trim(),
                        city = city.trim(),
                        contact = contact.trim(),
                        // A blank number is left out, so the server keeps the stored value.
                        experienceYears = experience.toIntOrNull(),
                        priceOnline = price.toIntOrNull(),
                        // Accepting is only an edit; the server ignores it on a new application.
                        accepting = if (isNew) null else accepting,
                    ),
                    isNew,
                )
            },
            enabled = !busy && name.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (isNew) Res.string.trb_profile_apply else Res.string.trb_profile_save)) }
    }
}

@Composable
private fun SessionsSection(
    data: SessionsResult?,
    busy: Boolean,
    onRetry: () -> Unit,
    onAdd: (Int, String, Int, Int?, String) -> Unit,
    onStatus: (Int, String) -> Unit,
    onDelete: (Int) -> Unit,
    modifier: Modifier,
) {
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (data == null) {
            item { LoadingOrRetry(busy, onRetry) }
        } else {
            item { SessionForm(data.clients, busy, onAdd) }
            if (data.sessions.isEmpty()) item { Text(stringResource(Res.string.trb_sessions_empty)) }
            items(data.sessions, key = { "session-${it.id}" }) { row ->
                SessionCard(row, busy, onStatus, onDelete)
            }
        }
    }
}

@Composable
private fun SessionForm(clients: List<BusinessClient>, busy: Boolean, onAdd: (Int, String, Int, Int?, String) -> Unit) {
    var clientId by remember { mutableStateOf<Int?>(null) }
    var whenText by remember { mutableStateOf("") }
    var duration by remember { mutableStateOf("60") }
    var price by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val startsAt = parseLocalStart(whenText)
    val minutes = duration.trim().toIntOrNull()
    val minutesOk = minutes != null && minutes in 5..600
    val priceOk = price.isBlank() || price.trim().toIntOrNull() != null
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(Res.string.trb_sessions_new), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (clients.isEmpty()) {
            Text(stringResource(Res.string.trb_sessions_no_clients), color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            ClientChips(clients, clientId) { clientId = it }
        }
        OutlinedTextField(
            whenText,
            { whenText = it.take(20) },
            label = { Text(stringResource(Res.string.trb_sessions_when)) },
            supportingText = { Text(stringResource(Res.string.trb_sessions_when_hint)) },
            isError = whenText.isNotBlank() && startsAt == null,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            duration,
            { duration = it.filter(Char::isDigit).take(3) },
            label = { Text(stringResource(Res.string.trb_sessions_duration)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            price,
            { price = it.filter(Char::isDigit).take(7) },
            label = { Text(stringResource(Res.string.trb_sessions_price)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(note, { note = it.take(300) }, label = { Text(stringResource(Res.string.trb_sessions_note)) }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                val id = clientId
                val at = startsAt
                val mins = minutes
                if (id != null && at != null && mins != null) onAdd(id, at, mins, price.trim().toIntOrNull(), note.trim())
            },
            enabled = !busy && clientId != null && startsAt != null && minutesOk && priceOk,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(Res.string.trb_sessions_add)) }
    }
}

@Composable
private fun SessionCard(row: SessionRow, busy: Boolean, onStatus: (Int, String) -> Unit, onDelete: (Int) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${formatLocalStart(row.startsAt)} · ${row.clientName}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            // The session price has no currency from the server, so it is shown as given.
            val details = listOfNotNull(
                stringResource(sessionStatusName(row.status)),
                stringResource(Res.string.tr_minutes, row.durationMin.toString()),
                row.price?.let { formatAmount(it) },
            )
            Text(details.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (row.note.isNotBlank()) Text(row.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (row.status == "planned") {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { onStatus(row.id, "done") }, enabled = !busy) { Text(stringResource(Res.string.trb_sessions_mark_done)) }
                    TextButton(onClick = { onStatus(row.id, "cancelled") }, enabled = !busy) { Text(stringResource(Res.string.trb_sessions_mark_cancelled)) }
                    TextButton(onClick = { onStatus(row.id, "no_show") }, enabled = !busy) { Text(stringResource(Res.string.trb_sessions_mark_no_show)) }
                }
            }
            TextButton(onClick = { onDelete(row.id) }, enabled = !busy) {
                Text(stringResource(Res.string.trb_sessions_delete), color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun FinanceSection(
    data: FinanceResult?,
    busy: Boolean,
    onRetry: () -> Unit,
    onRecord: (Int, Int, String) -> Unit,
    onDeletePayment: (Int) -> Unit,
    modifier: Modifier,
) {
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (data == null) {
            item { LoadingOrRetry(busy, onRetry) }
        } else {
            item { TotalsCard(data) }
            item { PaymentForm(data.clients, busy, onRecord) }
            items(data.ledgers, key = { "ledger-${it.clientId}" }) { row ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(row.clientName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            "${stringResource(Res.string.trb_finance_billed)}: ${formatMoney(row.billed, data.currency)} · " +
                                "${stringResource(Res.string.trb_finance_paid)}: ${formatMoney(row.paid, data.currency)} · " +
                                "${stringResource(Res.string.trb_finance_balance)}: ${formatMoney(row.balance, data.currency)}",
                        )
                        Text(
                            stringResource(Res.string.trb_finance_ledger_counts, row.sessionsDone, row.sessionsPlanned),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item { Text(stringResource(Res.string.trb_finance_payments), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            if (data.payments.isEmpty()) item { Text(stringResource(Res.string.trb_finance_no_payments)) }
            items(data.payments, key = { "payment-${it.id}" }) { p ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        // Each payment keeps its own currency; the server records it per payment.
                        Text("${formatMoney(p.amount, p.currency)} · ${p.clientName} · ${p.paidOn}", fontWeight = FontWeight.SemiBold)
                        if (p.note.isNotBlank()) Text(p.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = { onDeletePayment(p.id) }, enabled = !busy) {
                            Text(stringResource(Res.string.trb_finance_delete), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TotalsCard(data: FinanceResult) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${stringResource(Res.string.trb_finance_billed)}: ${formatMoney(data.totals.billed, data.currency)}")
            Text("${stringResource(Res.string.trb_finance_paid)}: ${formatMoney(data.totals.paid, data.currency)}")
            Text(
                "${stringResource(Res.string.trb_finance_balance)}: ${formatMoney(data.totals.balance, data.currency)}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun PaymentForm(clients: List<BusinessClient>, busy: Boolean, onRecord: (Int, Int, String) -> Unit) {
    var clientId by remember { mutableStateOf<Int?>(null) }
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val amountValue = amount.toIntOrNull()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(Res.string.trb_finance_record), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        ClientChips(clients, clientId) { clientId = it }
        OutlinedTextField(
            amount,
            { amount = it.filter(Char::isDigit).take(9) },
            label = { Text(stringResource(Res.string.trb_finance_amount)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(note, { note = it.take(300) }, label = { Text(stringResource(Res.string.trb_finance_pay_note)) }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                val id = clientId
                if (id != null && amountValue != null) onRecord(id, amountValue, note.trim())
            },
            enabled = !busy && clientId != null && amountValue != null && amountValue > 0,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(Res.string.trb_finance_record_button)) }
    }
}

@Composable
private fun TemplatesSection(
    templates: List<TemplateRow>?,
    clients: List<BusinessClient>,
    busy: Boolean,
    onRetry: () -> Unit,
    onCreate: (String, Int) -> Unit,
    onAssign: (Int, Int) -> Unit,
    onDelete: (Int) -> Unit,
    modifier: Modifier,
) {
    var pickedClient by remember { mutableStateOf<Int?>(null) }
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (templates == null) {
            item { LoadingOrRetry(busy, onRetry) }
        } else {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.trb_templates_pick_client), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (clients.isEmpty()) {
                        Text(stringResource(Res.string.trb_sessions_no_clients), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        ClientChips(clients, pickedClient) { pickedClient = it }
                    }
                    Text(stringResource(Res.string.trb_templates_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item { TemplateForm(busy, pickedClient, onCreate) }
            if (templates.isEmpty()) item { Text(stringResource(Res.string.trb_templates_empty)) }
            items(templates, key = { "template-${it.id}" }) { t ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(t.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            OutlinedButton(
                                onClick = { pickedClient?.let { onAssign(t.id, it) } },
                                enabled = !busy && pickedClient != null,
                            ) { Text(stringResource(Res.string.trb_templates_assign)) }
                            TextButton(onClick = { onDelete(t.id) }, enabled = !busy) {
                                Text(stringResource(Res.string.trb_templates_delete), color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TemplateForm(busy: Boolean, fromClient: Int?, onCreate: (String, Int) -> Unit) {
    var name by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            name,
            { name = it.take(60) },
            label = { Text(stringResource(Res.string.trb_templates_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = { fromClient?.let { onCreate(name.trim(), it) } },
            enabled = !busy && fromClient != null && name.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(Res.string.trb_templates_save)) }
    }
}

@Composable
private fun BroadcastSection(clientCount: Int?, busy: Boolean, onSend: (String) -> Unit, modifier: Modifier) {
    var text by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    Column(modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            text,
            { text = it.take(1500) },
            label = { Text(stringResource(Res.string.trb_broadcast_text)) },
            supportingText = { Text(stringResource(Res.string.trb_broadcast_limit)) },
            minLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
        // Sending needs a confirmed client count, so the button waits for the client list to load.
        Button(
            onClick = { confirming = true },
            enabled = !busy && clientCount != null && text.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(Res.string.trb_broadcast_send)) }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(Res.string.trb_broadcast_confirm_title)) },
            text = { Text(stringResource(Res.string.trb_broadcast_confirm_text, clientCount ?: 0)) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onSend(text.trim())
                }) { Text(stringResource(Res.string.trb_broadcast_confirm)) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(Res.string.trb_broadcast_cancel)) } },
        )
    }
}

@Composable
private fun ClientChips(clients: List<BusinessClient>, selected: Int?, onSelect: (Int) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        clients.forEach { c ->
            FilterChip(selected = c.id == selected, onClick = { onSelect(c.id) }, label = { Text(c.name.ifBlank { "#${c.id}" }) })
        }
    }
}

@Composable
private fun LoadingOrRetry(busy: Boolean, onRetry: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
        if (busy) CircularProgressIndicator() else Button(onClick = onRetry) { Text(stringResource(Res.string.retry)) }
    }
}

@Composable
private fun noticeText(notice: TrainerBusinessViewModel.Notice, count: Int): String {
    val res = when (notice) {
        TrainerBusinessViewModel.Notice.PROFILE_SAVED -> Res.string.trb_profile_saved
        TrainerBusinessViewModel.Notice.APPLIED -> Res.string.trb_profile_applied
        TrainerBusinessViewModel.Notice.SESSION_ADDED -> Res.string.trb_sessions_added
        TrainerBusinessViewModel.Notice.SESSION_UPDATED -> Res.string.trb_sessions_updated
        TrainerBusinessViewModel.Notice.SESSION_DELETED -> Res.string.trb_sessions_deleted
        TrainerBusinessViewModel.Notice.PAYMENT_RECORDED -> Res.string.trb_finance_recorded
        TrainerBusinessViewModel.Notice.PAYMENT_DELETED -> Res.string.trb_finance_deleted
        TrainerBusinessViewModel.Notice.TEMPLATE_SAVED -> Res.string.trb_templates_saved
        TrainerBusinessViewModel.Notice.TEMPLATE_ASSIGNED -> Res.string.trb_templates_assigned
        TrainerBusinessViewModel.Notice.TEMPLATE_DELETED -> Res.string.trb_templates_deleted
        TrainerBusinessViewModel.Notice.BROADCAST_SENT -> return stringResource(Res.string.trb_broadcast_sent, count)
    }
    return stringResource(res)
}

private fun sectionName(section: TrainerBusinessViewModel.Section): StringResource = when (section) {
    TrainerBusinessViewModel.Section.PROFILE -> Res.string.trb_section_profile
    TrainerBusinessViewModel.Section.SESSIONS -> Res.string.trb_section_sessions
    TrainerBusinessViewModel.Section.FINANCE -> Res.string.trb_section_finance
    TrainerBusinessViewModel.Section.TEMPLATES -> Res.string.trb_section_templates
    TrainerBusinessViewModel.Section.BROADCAST -> Res.string.trb_section_broadcast
}

private fun profileStatusName(status: String): StringResource = when (status) {
    "approved" -> Res.string.trb_status_approved
    "rejected" -> Res.string.trb_status_rejected
    else -> Res.string.trb_status_pending
}

private fun sessionStatusName(status: String): StringResource = when (status) {
    "done" -> Res.string.trb_status_done
    "cancelled" -> Res.string.trb_status_cancelled
    "no_show" -> Res.string.trb_status_no_show
    else -> Res.string.trb_status_planned
}

/** Server error codes that have their own wording here; everything else falls back to the shared sign-in text. */
private fun businessErrorText(code: String): StringResource = when (code) {
    "not_found" -> Res.string.trb_err_not_found
    "validation_error" -> Res.string.trb_err_invalid
    else -> errorText(code)
}
