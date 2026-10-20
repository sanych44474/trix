package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.onboarding.Answers
import app.hacklimits.shared.onboarding.OnboardingViewModel
import app.hacklimits.shared.onboarding.Step
import app.hacklimits.shared.onboarding.StepKind
import app.hacklimits.shared.onboarding.chosen
import app.hacklimits.shared.onboarding.isAnswered
import app.hacklimits.shared.programs.ProgramsViewModel
import app.hacklimits.shared.programs.ReadyProgramsSection
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

private val WEEKDAY_NUMBERS = (1..7).toList()

/**
 * The onboarding questionnaire: a welcome screen, then one question per screen (Mini App Onboarding).
 * [onFindTrainer] and [onBecomeCoach] open the trainer flows and show their buttons on the welcome
 * screen when given. [onDone] runs once the plan exists (or the ready program was applied).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingScreen(
    vm: OnboardingViewModel,
    onDone: () -> Unit,
    onClose: () -> Unit,
    onFindTrainer: (() -> Unit)? = null,
    onBecomeCoach: (() -> Unit)? = null,
) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(s.submitted) { if (s.submitted) onDone() }
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            s.mode == OnboardingViewModel.Mode.PICK -> {
                Text(stringResource(Res.string.ob_ready_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(stringResource(Res.string.ob_ready_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                val programs: ProgramsViewModel = koinViewModel()
                ReadyProgramsSection(programs, onApplied = onDone)
            }
            s.index < 0 -> Welcome(vm, onFindTrainer, onBecomeCoach, onClose)
            else -> Question(vm)
        }
    }
}

@Composable
private fun Welcome(
    vm: OnboardingViewModel,
    onFindTrainer: (() -> Unit)?,
    onBecomeCoach: (() -> Unit)?,
    onClose: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = onClose) { Text(stringResource(Res.string.pl_close)) }
        Text(stringResource(Res.string.ob_time), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.ob_welcome_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(stringResource(Res.string.ob_welcome_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = vm::start, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (vm.isClient) Res.string.ob_start_btn else Res.string.ob_role_athlete_btn))
        }
        if (!vm.isClient) {
            OutlinedButton(onClick = vm::startReady, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.ob_ready_btn)) }
            onFindTrainer?.let { open -> OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.ob_role_trainer_btn)) } }
            onBecomeCoach?.let { open -> OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.ob_role_coach_btn)) } }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Question(vm: OnboardingViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val steps = vm.stepsOf(s)
    val shown = minOf(s.index, steps.size - 1)
    val step = steps[shown]
    val answers = s.answers
    val last = shown == steps.size - 1
    val answered = isAnswered(step, answers)

    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        TextButton(onClick = vm::back) { Text("← " + stringResource(Res.string.ob_back_btn)) }
        Text(
            stringResource(Res.string.ob_step_of, shown + 1, steps.size),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    LinearProgressIndicator(progress = { (shown + 1f) / steps.size }, modifier = Modifier.fillMaxWidth())

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(step.question), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        step.hint?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        when (step.kind) {
            StepKind.CHOICE -> ChoiceOptions(vm, step, answers, enabled = !s.saving)
            StepKind.NUMBER -> NumberField(vm, step, answers)
            StepKind.LIFTS -> LiftFields(vm, answers)
            StepKind.DAYS -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                WEEKDAY_NUMBERS.forEach { d ->
                    FilterChip(
                        selected = d in answers.trainingWeekdays,
                        onClick = { vm.toggleDay(d) },
                        label = { Text(stringResource(weekdayRes(d))) },
                    )
                }
            }
            StepKind.TEXT -> TextAnswer(vm, answers)
        }
    }

    s.failure?.let { failure ->
        Text(
            stringResource(if (failure == OnboardingViewModel.Failure.VALIDATION) Res.string.ob_validation_error_hint else Res.string.ob_onboarding_save_error),
            color = MaterialTheme.colorScheme.error,
        )
    }
    if (s.saving) Text(stringResource(Res.string.ob_building_plan_ellipsis), color = MaterialTheme.colorScheme.onSurfaceVariant)

    if (step.kind != StepKind.CHOICE) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (step.kind == StepKind.LIFTS) {
                OutlinedButton(onClick = vm::skipLifts, enabled = !s.saving, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.ob_skip_btn)) }
            }
            val textOk = step.kind != StepKind.TEXT || !answers.limitations.isNullOrBlank()
            Button(
                onClick = vm::next,
                enabled = !s.saving && answered && textOk,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(if (last) Res.string.ob_finish_btn else Res.string.ob_next_btn))
            }
        }
    }
}

@Composable
private fun ChoiceOptions(vm: OnboardingViewModel, step: Step, answers: Answers, enabled: Boolean) {
    val current = chosen(step, answers)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        step.options.forEach { option ->
            val selected = current == option.value
            if (selected) {
                Button(onClick = { vm.chooseOption(step, option.value) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(option.label))
                }
            } else {
                OutlinedButton(onClick = { vm.chooseOption(step, option.value) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(option.label))
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NumberField(vm: OnboardingViewModel, step: Step, answers: Answers) {
    val spec = step.number ?: return
    val initial = when (step.id) {
        app.hacklimits.shared.onboarding.StepId.AGE -> answers.age?.toString()
        app.hacklimits.shared.onboarding.StepId.HEIGHT -> answers.heightCm?.toString()
        else -> answers.weightKg?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }
    }.orEmpty()
    var raw by remember(step.id) { mutableStateOf(initial) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        OutlinedTextField(
            value = raw,
            onValueChange = { raw = it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(6); vm.setNumber(step.id, raw) },
            placeholder = { Text(spec.placeholder) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = if (spec.step < 1.0) KeyboardType.Decimal else KeyboardType.Number),
            keyboardActions = KeyboardActions(onDone = { vm.next() }),
            modifier = Modifier.weight(1f),
        )
        Text(stringResource(spec.unit), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LiftFields(vm: OnboardingViewModel, answers: Answers) {
    val lifts = listOf(
        "bench" to Res.string.ob_lift_bench,
        "squat" to Res.string.ob_lift_squat,
        "deadlift" to Res.string.ob_lift_deadlift,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        lifts.forEach { (key, label) ->
            val value = when (key) {
                "bench" -> answers.lifts?.bench
                "squat" -> answers.lifts?.squat
                else -> answers.lifts?.deadlift
            }
            var raw by remember(key) { mutableStateOf(value?.toString().orEmpty()) }
            OutlinedTextField(
                value = raw,
                onValueChange = { raw = it.filter(Char::isDigit).take(3); vm.setLift(key, raw) },
                label = { Text(stringResource(label)) },
                placeholder = { Text(stringResource(Res.string.pl_unit_kg_ph)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun TextAnswer(vm: OnboardingViewModel, answers: Answers) {
    val text = answers.limitations.takeIf { it != "none" }.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = vm::setLimitations,
            placeholder = { Text(stringResource(Res.string.ob_limitations_ph)) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(onClick = vm::noLimitations, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.ob_no_limits_btn))
        }
    }
}

private fun weekdayRes(weekday: Int) = when (weekday) {
    1 -> Res.string.pl_weekday_mon
    2 -> Res.string.pl_weekday_tue
    3 -> Res.string.pl_weekday_wed
    4 -> Res.string.pl_weekday_thu
    5 -> Res.string.pl_weekday_fri
    6 -> Res.string.pl_weekday_sat
    else -> Res.string.pl_weekday_sun
}
