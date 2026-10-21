package app.hacklimits.shared.plan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import org.jetbrains.compose.resources.stringResource

/** Report an injury and see the ones still being tracked; the server adapts the plan around them. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InjuriesScreen(vm: InjuriesViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
        Text(stringResource(Res.string.pl_recovery_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.pl_report_injury_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        val data = s.data
        when {
            data == null && s.loading -> Text("…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            data == null -> {
                Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
            }
            else -> {
                if (data.injuries.isNotEmpty()) {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            data.injuries.forEach { injury ->
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(injury.area, fontWeight = FontWeight.SemiBold)
                                        Text(
                                            stringResource(Res.string.pl_since_date, injury.since),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(injury.severity)
                                }
                            }
                        }
                    }
                }

                Text(data.areas.firstOrNull { it.value == s.area }?.label.orEmpty(), style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    data.areas.forEach { area ->
                        FilterChip(selected = s.area == area.value, onClick = { vm.selectArea(area.value) }, label = { Text(area.label) })
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    data.severities.forEach { severity ->
                        FilterChip(selected = s.severity == severity.value, onClick = { vm.selectSeverity(severity.value) }, label = { Text(severity.label) })
                    }
                }
                Button(onClick = vm::report, enabled = !s.busy && s.area.isNotEmpty() && s.severity.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(if (s.busy) Res.string.pl_saving_ellipsis else Res.string.pl_report_btn))
                }
                if (s.actionError) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                        TextButton(onClick = vm::dismissActionError) { Text(stringResource(Res.string.pl_close)) }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
