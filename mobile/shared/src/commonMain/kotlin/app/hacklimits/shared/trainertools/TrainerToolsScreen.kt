package app.hacklimits.shared.trainertools

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/** Program sharing for trainers with instructor access: publish a template, get its link, publish
 * my own plan, or assign a template to the clients I pick. Same rules as the bot's share flow. */
@Composable
fun ProgramSharingScreen(onBack: () -> Unit) {
    val vm: ProgramSharingViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    var myName by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.tt_share_title), style = MaterialTheme.typography.titleLarge)
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(Res.string.tt_share_hint), style = MaterialTheme.typography.bodyMedium)
            if (s.loading) CircularProgressIndicator()
            s.loadError?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) }

            // Publish: pick a saved template, then the library or a link.
            Text(stringResource(Res.string.tt_publish_heading), style = MaterialTheme.typography.titleMedium)
            val templates = s.templates
            if (templates != null) {
                if (templates.isEmpty()) {
                    Text(stringResource(Res.string.tt_templates_empty))
                } else {
                    templates.forEach { tpl ->
                        if (tpl.id == s.templateId) {
                            Button(onClick = { vm.pickTemplate(tpl.id) }, modifier = Modifier.fillMaxWidth()) { Text(tpl.name) }
                        } else {
                            OutlinedButton(onClick = { vm.pickTemplate(tpl.id) }, modifier = Modifier.fillMaxWidth()) { Text(tpl.name) }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = s.templateId != null && !s.busy, onClick = { vm.publish(library = true) }) {
                            Text(stringResource(Res.string.tt_publish_library))
                        }
                        OutlinedButton(enabled = s.templateId != null && !s.busy, onClick = { vm.publish(library = false) }) {
                            Text(stringResource(Res.string.tt_publish_link))
                        }
                    }
                }
            }

            // Publish my own active plan to the library.
            Text(stringResource(Res.string.tt_my_plan_title), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = myName,
                onValueChange = { myName = it.take(48) },
                label = { Text(stringResource(Res.string.tt_my_plan_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(enabled = myName.isNotBlank() && !s.busy, onClick = { vm.publishOwnPlan(myName) }) {
                Text(stringResource(Res.string.tt_my_plan_btn))
            }

            // Assign the selected template to the clients ticked below.
            Text(stringResource(Res.string.tt_assign_title), style = MaterialTheme.typography.titleMedium)
            if (s.clients.isEmpty()) {
                Text(stringResource(Res.string.tt_no_clients))
            } else {
                s.clients.forEach { client ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = client.id in s.picked, onCheckedChange = { vm.toggleClient(client.id) })
                        Text(client.name)
                    }
                }
                Button(
                    enabled = s.templateId != null && s.picked.isNotEmpty() && !s.busy,
                    onClick = { vm.assign() },
                ) { Text(stringResource(Res.string.tt_assign_btn, s.picked.size)) }
                if (s.templateId == null) Text(stringResource(Res.string.tt_pick_template), style = MaterialTheme.typography.bodySmall)
            }

            // Outcome of the last action.
            when (val d = s.done) {
                is ProgramSharingViewModel.Done.Published -> {
                    Text(stringResource(Res.string.tt_published, d.name))
                    d.link?.let {
                        Text(stringResource(Res.string.tt_link_ready))
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
                is ProgramSharingViewModel.Done.Assigned -> Text(stringResource(Res.string.tt_assigned, d.ok, d.total))
                null -> Unit
            }
            s.error?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) }
        }
    }
}

/** The weekly client report: the bot's /trreport table as a card per client, most active first. */
@Composable
fun TrainerReportScreen(onBack: () -> Unit) {
    val vm: TrainerReportViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.tt_report_title), style = MaterialTheme.typography.titleLarge)
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (s.loading) CircularProgressIndicator()
            s.loadError?.let {
                Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { vm.load() }) { Text(stringResource(Res.string.tt_retry)) }
            }
            val report = s.report
            if (report != null) {
                Text(stringResource(Res.string.tt_report_active, report.active7, report.clientCount, report.activePct), style = MaterialTheme.typography.titleMedium)
                if (report.rows.isEmpty()) Text(stringResource(Res.string.tt_report_empty))
                report.rows.forEach { row ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.name ?: "#${row.id}", style = MaterialTheme.typography.titleSmall)
                            val interview = if (row.onboarded) stringResource(Res.string.tt_report_interview_ok)
                            else stringResource(Res.string.tt_report_interview, row.interview.filled, row.interview.total)
                            Text("${row.username?.let { "@$it" } ?: "—"} · $interview", style = MaterialTheme.typography.bodySmall)
                            Text(
                                stringResource(Res.string.tt_report_events, row.events.workouts, row.events.checkins, row.events.nutrition, row.events.steps) +
                                    " · " + (row.lastSeen?.let { if (it.length >= 10) it.substring(5, 10) else it } ?: "—"),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(stringResource(if (row.plan.active) Res.string.tt_plan_active else Res.string.tt_plan_none), style = MaterialTheme.typography.labelMedium)
                                if (row.botBlocked) Text(stringResource(Res.string.tt_bot_blocked), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
                Text(stringResource(Res.string.tt_report_legend), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** Owner roster card: the inactive-user count, then a second tap confirms the bulk delete. */
@Composable
fun OwnerCleanupCard() {
    val vm: OwnerCleanupViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.tt_cleanup_title, s.days), style = MaterialTheme.typography.titleMedium)
            s.error?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) }
            val deleted = s.deleted
            val count = s.count
            when {
                deleted != null -> Text(stringResource(Res.string.tt_cleanup_done, deleted))
                count == null -> if (s.error == null) CircularProgressIndicator()
                count == 0 -> Text(stringResource(Res.string.tt_cleanup_none))
                s.confirming -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.tt_cleanup_warning), style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !s.busy, onClick = { vm.purge() }) { Text(stringResource(Res.string.tt_cleanup_confirm, count)) }
                        OutlinedButton(enabled = !s.busy, onClick = { vm.cancelConfirm() }) { Text(stringResource(Res.string.tt_cancel)) }
                    }
                }
                else -> OutlinedButton(enabled = !s.busy, onClick = { vm.askConfirm() }) {
                    Text(stringResource(Res.string.tt_cleanup_btn, count))
                }
            }
        }
    }
}
