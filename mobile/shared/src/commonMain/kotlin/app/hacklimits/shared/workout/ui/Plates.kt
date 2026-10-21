package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_generic_error
import app.hacklimits.shared.resources.wk_plates_calc_btn
import app.hacklimits.shared.resources.wk_plates_kg_ph
import app.hacklimits.shared.resources.wk_plates_leftover
import app.hacklimits.shared.resources.wk_plates_per_side
import app.hacklimits.shared.resources.wk_plates_title
import app.hacklimits.shared.resources.wk_plates_warmup_title
import app.hacklimits.shared.resources.wk_ph_kg
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import org.jetbrains.compose.resources.stringResource

/** The plate calculator: the plates for a total weight on the bar, and the warm-up ramp toward it. */
@Composable
fun PlatesCalculator(vm: LoggerViewModel, s: LoggerUi) {
    val plates = s.plates
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(Res.string.wk_plates_title), style = MaterialTheme.typography.titleSmall, fontWeight = null)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = plates.kgText,
                onValueChange = { vm.setPlatesText(it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(7)) },
                placeholder = { Text(stringResource(Res.string.wk_plates_kg_ph)) },
                singleLine = true,
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { vm.calcPlates() }),
            )
            Button(onClick = { vm.calcPlates() }, enabled = !plates.busy) {
                Text(stringResource(Res.string.wk_plates_calc_btn))
            }
        }
        if (plates.failed) {
            Text(stringResource(Res.string.wk_generic_error), color = MaterialTheme.colorScheme.error)
        }
        plates.result?.let { result ->
            result.plan?.let { plan ->
                val perSide = plan.perSide.joinToString(" + ") { fmtNum(it) }.ifEmpty { "—" }
                val leftover = if (plan.leftover != 0.0) " · " + stringResource(Res.string.wk_plates_leftover, fmtNum(plan.leftover)) else ""
                Text(
                    "${fmtNum(plan.loaded)} ${stringResource(Res.string.wk_ph_kg)} · ${stringResource(Res.string.wk_plates_per_side)}: $perSide$leftover",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (result.ramp.isNotEmpty()) {
                Text(stringResource(Res.string.wk_plates_warmup_title), style = MaterialTheme.typography.labelLarge)
                result.ramp.forEach { set ->
                    val pct = if (set.pct > 0) " (${set.pct}%)" else ""
                    Text("${fmtNum(set.weight)} ${stringResource(Res.string.wk_ph_kg)} × ${set.reps}$pct")
                }
            }
        }
    }
}
