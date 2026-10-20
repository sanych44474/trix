package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.settings.MoreViewModel
import app.hacklimits.shared.settings.MoreViewModel.Message
import org.jetbrains.compose.resources.stringResource

@Composable
fun MoreScreen(vm: MoreViewModel, privacyUrl: String?, onSignOut: () -> Unit, beforeSignOut: suspend () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current
    var confirmDelete by remember { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(Res.string.more_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        s.message?.let { msg ->
            val text = when (msg) {
                Message.Saved -> Res.string.saved
                Message.Exported -> Res.string.more_exported
                Message.EmailLinked -> Res.string.more_email_linked
                Message.GoogleLinked -> Res.string.more_google_linked
                Message.Error -> Res.string.err_generic
                Message.NetworkError -> Res.string.err_network
            }
            Text(stringResource(text), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                color = if (msg == Message.Error || msg == Message.NetworkError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        }

        Section(stringResource(Res.string.more_account)) {
            val session = s.session
            session?.email?.let { Text(stringResource(Res.string.more_email_is, it)) }
            if (session?.googleLinked == true) Text(stringResource(Res.string.more_google_linked))
            else OutlinedButton(onClick = vm::linkGoogle, enabled = !s.busy) { Text(stringResource(Res.string.more_link_google)) }
            if (session?.email == null) {
                if (s.linkChallengeId == null) {
                    OutlinedTextField(s.linkEmail, vm::onLinkEmail, label = { Text(stringResource(Res.string.signin_email)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                    OutlinedButton(onClick = vm::sendLinkCode, enabled = !s.busy && s.linkEmail.contains('@')) { Text(stringResource(Res.string.more_link_email)) }
                } else {
                    OutlinedTextField(s.linkCode, vm::onLinkCode, label = { Text(stringResource(Res.string.signin_code)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                    Button(onClick = vm::verifyLinkCode, enabled = !s.busy && s.linkCode.length == 6) { Text(stringResource(Res.string.signin_verify)) }
                }
            }
            TextButton(onClick = onSignOut) { Text(stringResource(Res.string.sign_out)) }
        }

        s.settings?.let { settings ->
            Section(stringResource(Res.string.more_reminders)) {
                settings.reminders.forEach { r ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(r.label, Modifier.weight(1f))
                        Switch(checked = r.on, onCheckedChange = { vm.toggleReminder(r.key) }, enabled = !s.busy)
                    }
                }
            }
            Section(stringResource(Res.string.more_language)) {
                Text(stringResource(Res.string.more_language_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = settings.lang == "uk", onClick = { vm.setLanguage("uk") }, label = { Text("Українська") })
                    FilterChip(selected = settings.lang == "en", onClick = { vm.setLanguage("en") }, label = { Text("English") })
                }
            }
            Section(stringResource(Res.string.more_vacation)) {
                if (settings.vacationUntil != null) {
                    Text(stringResource(Res.string.more_vacation_until, settings.vacationUntil))
                    OutlinedButton(onClick = { vm.vacation(null) }) { Text(stringResource(Res.string.more_vacation_end)) }
                } else {
                    Text(stringResource(Res.string.more_vacation_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(3, 7, 14).forEach { d -> OutlinedButton(onClick = { vm.vacation(d) }) { Text(stringResource(Res.string.more_days, d)) } }
                    }
                }
            }
        }

        Section(stringResource(Res.string.more_data)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.export(false) }, enabled = !s.busy) { Text(stringResource(Res.string.more_export_text)) }
                OutlinedButton(onClick = { vm.export(true) }, enabled = !s.busy) { Text(stringResource(Res.string.more_export_json)) }
            }
            privacyUrl?.let { url -> TextButton(onClick = { uri.openUri(url) }) { Text(stringResource(Res.string.more_privacy)) } }
            TextButton(onClick = { confirmDelete = 1 }) { Text(stringResource(Res.string.more_delete), color = MaterialTheme.colorScheme.error) }
        }
    }

    if (confirmDelete > 0) {
        AlertDialog(
            onDismissRequest = { confirmDelete = 0 },
            title = { Text(stringResource(Res.string.more_delete_title)) },
            text = { Text(stringResource(if (confirmDelete == 1) Res.string.more_delete_body else Res.string.more_delete_final)) },
            confirmButton = {
                Button(
                    onClick = { if (confirmDelete == 1) confirmDelete = 2 else { confirmDelete = 0; vm.deleteAccount(beforeSignOut) } },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(if (confirmDelete == 1) Res.string.ob_next else Res.string.more_delete_confirm)) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = 0 }) { Text(stringResource(Res.string.tg_cancel)) } },
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
