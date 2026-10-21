package app.hacklimits.shared.account

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.stringResource

/** Choose a trainer: one card per approved trainer. [onAccepted] fires once the trainer accepts and the
 * caller becomes a client (the lead should refresh the dashboard then). */
@Composable
fun FindTrainerScreen(vm: FindTrainerViewModel, onBack: () -> Unit, onAccepted: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(s.accepted) { if (s.accepted) onAccepted() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack) { Text("← " + stringResource(Res.string.ex_find_back)) }
        Text(stringResource(Res.string.ex_find_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(stringResource(Res.string.ex_find_body), color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (s.loadError || s.actionError) {
            Text(stringResource(Res.string.ac_generic_error), color = MaterialTheme.colorScheme.error)
        }

        val directory = s.directory
        if (directory == null) {
            if (!s.loadError) CircularProgressIndicator()
            return@Column
        }

        directory.pending?.let { pending ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.ex_find_pending_title, pending.name), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(Res.string.ex_find_pending_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = vm::cancel, enabled = !s.cancelling) { Text(stringResource(Res.string.ex_find_cancel)) }
                }
            }
        }

        if (directory.pending == null) {
            if (directory.trainers.isEmpty()) {
                Text(stringResource(Res.string.ex_find_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                directory.trainers.forEach { trainer ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(trainer.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                if (trainer.city.isNotBlank()) {
                                    Text(trainer.city, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            if (trainer.specialization.isNotBlank()) Text(trainer.specialization)
                            val meta = buildList {
                                trainer.experienceYears?.let { add(stringResource(Res.string.ex_find_years, it.toString())) }
                                trainer.priceOnline?.let { add(stringResource(Res.string.ex_find_price, it.toString(), trainer.currency ?: "")) }
                            }
                            if (meta.isNotEmpty()) {
                                Text(meta.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (trainer.bio.isNotBlank()) {
                                Text(trainer.bio, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Button(
                                onClick = { vm.choose(trainer.id) },
                                enabled = s.busyTrainerId == null,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(stringResource(Res.string.ex_find_choose))
                            }
                        }
                    }
                }
            }
        }
    }
}
