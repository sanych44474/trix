package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.today.QuickLogViewModel
import app.hacklimits.shared.today.QuickLogViewModel.Done
import org.jetbrains.compose.resources.stringResource

@Composable
fun QuickLogCard(vm: QuickLogViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(Res.string.quick_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(Res.string.quick_water, s.waterToday), Modifier.weight(1f))
                FilledTonalButton(onClick = { vm.addWater() }, enabled = !s.busy) { Text("+250 ml") }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(s.steps, vm::onSteps, label = { Text(stringResource(Res.string.quick_steps)) }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                FilledTonalButton(onClick = vm::saveSteps, enabled = !s.busy && s.steps.isNotBlank()) { Text(stringResource(Res.string.save)) }
            }
            Text(stringResource(Res.string.quick_checkin), fontWeight = FontWeight.Medium)
            Scale(stringResource(Res.string.quick_energy), s.energy, vm::setEnergy)
            Scale(stringResource(Res.string.quick_sleep), s.sleep, vm::setSleep)
            Scale(stringResource(Res.string.quick_stress), s.stress, vm::setStress)
            TextButton(onClick = vm::saveCheckin, enabled = !s.busy) { Text(stringResource(Res.string.quick_checkin_save)) }
            val feedback = when {
                s.failed -> Res.string.err_network
                s.done == Done.Water -> Res.string.quick_saved_water
                s.done == Done.Steps -> Res.string.quick_saved_steps
                s.done == Done.Checkin -> Res.string.quick_saved_checkin
                else -> null
            }
            feedback?.let {
                Text(stringResource(it), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    color = if (s.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun Scale(label: String, value: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("$label: $value", Modifier.weight(0.4f))
        Slider(value = value.toFloat(), onValueChange = { onChange(it.toInt()) }, valueRange = 1f..5f, steps = 3, modifier = Modifier.weight(0.6f))
    }
}
