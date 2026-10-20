package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.onboarding.OnboardingViewModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingScreen(vm: OnboardingViewModel, onDone: () -> Unit, onClose: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(s.submitted) { if (s.submitted) onDone() }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row {
            TextButton(onClick = { if (s.step == 0) onClose() else vm.back() }) { Text(stringResource(Res.string.back)) }
        }
        LinearProgressIndicator(progress = { (s.step + 1) / (OnboardingViewModel.LAST_STEP + 1f) }, modifier = Modifier.fillMaxWidth())
        val a = s.answers
        when (s.step) {
            0 -> Question(Res.string.ob_goal_q) {
                Options(OnboardingViewModel.GOALS, a.goal, ::goalLabel) { v -> vm.update { it.copy(goal = v) } }
            }
            1 -> {
                Question(Res.string.ob_level_q) { Options(OnboardingViewModel.LEVELS, a.level, ::levelLabel) { v -> vm.update { it.copy(level = v) } } }
                Question(Res.string.ob_equipment_q) { Options(OnboardingViewModel.EQUIPMENT, a.equipment, ::equipmentLabel) { v -> vm.update { it.copy(equipment = v) } } }
            }
            2 -> Question(Res.string.ob_days_q) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (1..7).forEach { d -> FilterChip(selected = d in a.trainingWeekdays, onClick = { vm.toggleDay(d) }, label = { Text(stringResource(weekdayName(d))) }) }
                }
                Text(stringResource(Res.string.ob_days_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> Question(Res.string.ob_about_q) {
                Options(listOf("male", "female"), a.sex, ::sexLabel) { v -> vm.update { it.copy(sex = v) } }
                NumberInput(a.age?.toString() ?: "", Res.string.ob_age) { v -> vm.update { it.copy(age = v.toIntOrNull()) } }
                NumberInput(a.heightCm?.toString() ?: "", Res.string.ob_height_optional) { v -> vm.update { it.copy(heightCm = v.toIntOrNull()) } }
                NumberInput(a.weightKg?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() } ?: "", Res.string.ob_weight_optional, decimal = true) { v ->
                    vm.update { it.copy(weightKg = v.replace(',', '.').toDoubleOrNull()) }
                }
            }
        }
        s.error?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(8.dp))
        Button(onClick = vm::next, enabled = s.canContinue && !s.busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text(stringResource(if (s.step == OnboardingViewModel.LAST_STEP) Res.string.ob_finish else Res.string.ob_next))
        }
    }
}

@Composable
private fun Question(title: StringResource, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Options(values: List<String>, selected: String?, label: (String) -> StringResource, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        values.forEach { v -> FilterChip(selected = v == selected, onClick = { onPick(v) }, label = { Text(stringResource(label(v))) }) }
    }
}

@Composable
private fun NumberInput(value: String, label: StringResource, decimal: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { raw -> onChange(raw.filter { it.isDigit() || (decimal && (it == '.' || it == ',')) }.take(5)) },
        label = { Text(stringResource(label)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
    )
}

private fun goalLabel(v: String) = when (v) {
    "fat loss" -> Res.string.goal_fat_loss
    "muscle gain" -> Res.string.goal_muscle
    "recomposition" -> Res.string.goal_recomp
    "strength" -> Res.string.goal_strength
    else -> Res.string.goal_endurance
}
private fun levelLabel(v: String) = when (v) {
    "beginner" -> Res.string.level_beginner
    "intermediate" -> Res.string.level_intermediate
    else -> Res.string.level_advanced
}
private fun equipmentLabel(v: String) = when (v) {
    "full gym" -> Res.string.eq_gym
    "home basics (dumbbells, bands)" -> Res.string.eq_home
    "dumbbells only" -> Res.string.eq_dumbbells
    else -> Res.string.eq_bodyweight
}
private fun sexLabel(v: String) = if (v == "male") Res.string.sex_male else Res.string.sex_female
