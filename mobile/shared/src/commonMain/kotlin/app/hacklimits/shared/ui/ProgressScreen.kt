package app.hacklimits.shared.ui

import app.hacklimits.shared.daily.WellbeingCard
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.DayWorkout
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.data.TrainingSignals
import app.hacklimits.shared.resources.sig_lift_progressing
import app.hacklimits.shared.resources.sig_lift_regressing
import app.hacklimits.shared.resources.sig_lift_stalled
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import app.hacklimits.shared.progress.muscle.LoggedDay
import app.hacklimits.shared.progress.ProgressNotice
import app.hacklimits.shared.progress.ProgressSection
import app.hacklimits.shared.progress.ProgressViewModel
import app.hacklimits.shared.progress.body.BodyMapCard
import app.hacklimits.shared.progress.macroHistory
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.jsRound
import app.hacklimits.shared.progress.body.recentExerciseNames
import app.hacklimits.shared.progress.targetsForDay
import app.hacklimits.shared.progress.ui.ChartPoint
import app.hacklimits.shared.progress.ui.LineChart
import app.hacklimits.shared.progress.ui.MacroDonut
import app.hacklimits.shared.progress.ui.MuscleTrendView
import app.hacklimits.shared.progress.ui.MutedText
import app.hacklimits.shared.progress.ui.PhotoPairView
import app.hacklimits.shared.progress.ui.ProgressCard
import app.hacklimits.shared.progress.ui.RecordsView
import app.hacklimits.shared.progress.ui.SelectField
import app.hacklimits.shared.progress.ui.Swatch
import app.hacklimits.shared.progress.ui.WeightChartView
import app.hacklimits.shared.progress.ui.formatNumber
import app.hacklimits.shared.progress.ui.groupLabel
import app.hacklimits.shared.progress.ui.measureLabel
import app.hacklimits.shared.progress.ui.muscleLabel
import app.hacklimits.shared.progress.ui.shortDate
import app.hacklimits.shared.progress.ui.zoneLabel
import app.hacklimits.shared.progress.weekSummary
import app.hacklimits.shared.telemetry.Telemetry
import org.koin.compose.koinInject
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_build_baseline_detail
import app.hacklimits.shared.resources.pr_calendar_done_count
import app.hacklimits.shared.resources.pr_activity_calendar_title
import app.hacklimits.shared.resources.pr_day_detail_macros_title
import app.hacklimits.shared.resources.pr_day_detail_measure_title
import app.hacklimits.shared.resources.pr_day_detail_no_log
import app.hacklimits.shared.resources.pr_day_detail_no_macros
import app.hacklimits.shared.resources.pr_day_detail_unavailable
import app.hacklimits.shared.resources.pr_day_detail_workout_title
import app.hacklimits.shared.resources.pr_done_label
import app.hacklimits.shared.resources.pr_energy_label
import app.hacklimits.shared.resources.pr_fuel_rest_day_badge
import app.hacklimits.shared.resources.pr_generic_error
import app.hacklimits.shared.resources.pr_goal_kg
import app.hacklimits.shared.resources.pr_goal_reached
import app.hacklimits.shared.resources.pr_kcal_of_target
import app.hacklimits.shared.resources.pr_kcal_unit
import app.hacklimits.shared.resources.pr_log_today_title
import app.hacklimits.shared.resources.pr_macro_breakdown_empty
import app.hacklimits.shared.resources.pr_macro_breakdown_title
import app.hacklimits.shared.resources.pr_macro_empty
import app.hacklimits.shared.resources.pr_macro_line
import app.hacklimits.shared.resources.pr_macro_trend_title
import app.hacklimits.shared.resources.pr_measure_ph
import app.hacklimits.shared.resources.pr_measurements_pick_key_label
import app.hacklimits.shared.resources.pr_measurements_title
import app.hacklimits.shared.resources.pr_metric_body_fat
import app.hacklimits.shared.resources.pr_metric_carbs
import app.hacklimits.shared.resources.pr_metric_fats
import app.hacklimits.shared.resources.pr_metric_protein
import app.hacklimits.shared.resources.pr_missed_label
import app.hacklimits.shared.resources.pr_muscle_map_title
import app.hacklimits.shared.resources.pr_no_volume_detail
import app.hacklimits.shared.resources.pr_no_volume_title
import app.hacklimits.shared.resources.pr_on_track
import app.hacklimits.shared.resources.pr_period_3m
import app.hacklimits.shared.resources.pr_period_month
import app.hacklimits.shared.resources.pr_period_week
import app.hacklimits.shared.resources.pr_progress_photo_uploaded_note
import app.hacklimits.shared.resources.pr_proof_progress_title
import app.hacklimits.shared.resources.pr_progress_photo_upload_btn
import app.hacklimits.shared.resources.pr_progress_photo_upload_hint
import app.hacklimits.shared.resources.pr_progress_photo_upload_title
import app.hacklimits.shared.resources.pr_progress_saved_note
import app.hacklimits.shared.resources.pr_progress_tab_body
import app.hacklimits.shared.resources.pr_progress_tab_food
import app.hacklimits.shared.resources.pr_progress_tab_train
import app.hacklimits.shared.resources.pr_progress_title
import app.hacklimits.shared.resources.pr_pw_sets
import app.hacklimits.shared.resources.pr_pw_weight
import app.hacklimits.shared.resources.pr_pw_weight_delta
import app.hacklimits.shared.resources.pr_pw_workouts
import app.hacklimits.shared.resources.pr_qt_body_label
import app.hacklimits.shared.resources.pr_qt_checkin_hint
import app.hacklimits.shared.resources.pr_qt_checkin_label
import app.hacklimits.shared.resources.pr_recovery_label
import app.hacklimits.shared.resources.pr_retry
import app.hacklimits.shared.resources.pr_save_checkin_btn
import app.hacklimits.shared.resources.pr_save_measure_btn
import app.hacklimits.shared.resources.pr_saving_ellipsis
import app.hacklimits.shared.resources.pr_sleep_label
import app.hacklimits.shared.resources.pr_strength_latest
import app.hacklimits.shared.resources.pr_strength_pick_exercise_label
import app.hacklimits.shared.resources.pr_strength_trend_empty
import app.hacklimits.shared.resources.pr_strength_trend_title
import app.hacklimits.shared.resources.pr_stress_label
import app.hacklimits.shared.resources.pr_trend_title
import app.hacklimits.shared.resources.pr_unit_cm
import app.hacklimits.shared.resources.pr_unit_g
import app.hacklimits.shared.resources.pr_unit_kg
import app.hacklimits.shared.resources.pr_volume_row_detail
import app.hacklimits.shared.resources.pr_weight_trend_eyebrow_plain
import app.hacklimits.shared.resources.pr_week_title
import org.jetbrains.compose.resources.stringResource
import kotlin.math.abs
import kotlin.math.max

/**
 * Progress: training (muscle map, calendar, strength and muscle trends, records), body (weight,
 * measurements, check-ins, progress photos) and food (macro breakdown and history).
 *
 * [trainExtras] is shown at the end of the Training tab (the Strava card, supplied by the caller).
 */
@Composable
fun ProgressScreen(vm: ProgressViewModel, trainExtras: @Composable () -> Unit = {}) {
    val s by vm.state.collectAsStateWithLifecycle()
    val telemetry = koinInject<Telemetry>()
    LaunchedEffect(Unit) { vm.refresh() }
    val d = s.data
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text(stringResource(Res.string.pr_progress_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        item { OfflineStatusNotice(s.offline, s.pendingSync, s.needsAttention, s.lastUpdatedAtMs) }
        when {
            d == null && s.error != null -> item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.pr_generic_error), color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = vm::refresh) { Text(stringResource(Res.string.pr_retry)) }
                }
            }
            d == null -> item {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            else -> {
                item { Summary(d, s.weightPeriod) }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                        for (section in ProgressSection.entries) {
                            FilterChip(
                                selected = s.section == section,
                                onClick = {
                                    vm.selectSection(section)
                                    telemetry.track("app_progress_${section.name.lowercase()}")
                                },
                                label = {
                                    Text(
                                        stringResource(
                                            when (section) {
                                                ProgressSection.TRAIN -> Res.string.pr_progress_tab_train
                                                ProgressSection.BODY -> Res.string.pr_progress_tab_body
                                                ProgressSection.FOOD -> Res.string.pr_progress_tab_food
                                            },
                                        ),
                                    )
                                },
                            )
                        }
                    }
                }
                when (s.section) {
                    ProgressSection.TRAIN -> trainTab(vm, s, d, trainExtras)
                    ProgressSection.BODY -> bodyTab(vm, s, d)
                    ProgressSection.FOOD -> foodTab(d)
                }
            }
        }
    }
}

private fun ProgressDashboard.uk(): Boolean = lang == "uk"

private val SIGNAL_STATUSES = setOf("progressing", "stalled", "regressing")

/** One chip per lift with a clear trend ("Bench · stalled"), wrapping so small phones never overflow. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LiftSignalChips(lifts: List<TrainingSignals.LiftSignal>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        lifts.forEach { lift ->
            val color = when (lift.status) {
                "progressing" -> MaterialTheme.colorScheme.primaryContainer
                "stalled" -> MaterialTheme.colorScheme.tertiaryContainer
                else -> MaterialTheme.colorScheme.errorContainer
            }
            val status = stringResource(
                when (lift.status) {
                    "progressing" -> Res.string.sig_lift_progressing
                    "stalled" -> Res.string.sig_lift_stalled
                    else -> Res.string.sig_lift_regressing
                },
            )
            Box(Modifier.clip(RoundedCornerShape(50)).background(color).padding(horizontal = 10.dp, vertical = 4.dp)) {
                Text("${lift.name} · $status", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun Summary(d: ProgressDashboard, weightPeriod: Int) {
    val uk = d.uk()
    val week = weekSummary(d)
    val latest = d.weight.points.maxByOrNull { it.date }
    val delta = week.weightDelta
    val deltaText = when {
        delta == null -> stringResource(Res.string.pr_pw_weight)
        else -> stringResource(
            Res.string.pr_pw_weight_delta,
            (if (delta > 0) "+" else if (delta < 0) "−" else "±") + formatNumber(abs(delta), uk),
        )
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SummaryCell("${week.weekDone}/${week.weekPlanned}", stringResource(Res.string.pr_pw_workouts), Modifier.weight(1f))
        SummaryCell(latest?.let { formatNumber(it.kg, uk) } ?: "—", deltaText, Modifier.weight(1f))
        SummaryCell(week.weekSets.toString(), stringResource(Res.string.pr_pw_sets), Modifier.weight(1f))
    }
}

@Composable
private fun SummaryCell(value: String, label: String, modifier: Modifier) {
    ProgressCard {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

// ---- Training tab ----

private fun LazyListScope.trainTab(vm: ProgressViewModel, s: ProgressViewModel.State, d: ProgressDashboard, trainExtras: @Composable () -> Unit) {
    val uk = d.uk()
    val logs: List<LoggedDay> = d.calendar.logs
    val hasLogs = logs.any { it.done }
    item {
        ProgressCard(stringResource(Res.string.pr_muscle_map_title)) {
            if (d.volume.isNotEmpty()) {
                BodyMapCard(
                    male = d.sex != "female",
                    logs = logs,
                    today = d.today,
                    planDays = s.planDays,
                    recentNames = recentExerciseNames(logs),
                    uk = uk,
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (row in d.volume) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(groupLabel(row.group), fontWeight = FontWeight.SemiBold)
                                Text(
                                    stringResource(
                                        Res.string.pr_volume_row_detail,
                                        formatNumber(row.sets, uk),
                                        zoneLabel(row.zone),
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            LinearProgressIndicator(
                                progress = { (row.sets / max(row.mav, 1).toDouble()).coerceIn(0.0, 1.0).toFloat() },
                                modifier = Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)),
                            )
                        }
                    }
                }
            } else {
                EmptyNote(stringResource(Res.string.pr_no_volume_title), stringResource(Res.string.pr_no_volume_detail))
            }
        }
    }

    item { CalendarCard(vm, s, d) }

    item {
        ProgressCard(stringResource(Res.string.pr_strength_trend_title)) {
            val lifts = s.signals?.exercises.orEmpty().filter { it.name.isNotBlank() && it.status in SIGNAL_STATUSES }
            if (lifts.isNotEmpty()) LiftSignalChips(lifts)
            val exercises = d.exercises
            if (exercises.isEmpty()) {
                MutedText(stringResource(Res.string.pr_strength_trend_empty))
            } else {
                val active = exercises.firstOrNull { it.name == s.exercise } ?: exercises.first()
                SelectField(
                    stringResource(Res.string.pr_strength_pick_exercise_label),
                    active.name,
                    exercises.map { it.name to it.name },
                ) { vm.selectExercise(it) }
                LineChart(active.points.map { ChartPoint(it.date, it.e1rm) }, MaterialTheme.colorScheme.primary)
                active.points.lastOrNull()?.let {
                    MutedText(stringResource(Res.string.pr_strength_latest, formatNumber(it.e1rm, uk), stringResource(Res.string.pr_unit_kg)))
                }
            }
        }
    }

    if (hasLogs) item {
        ProgressCard(stringResource(Res.string.pr_trend_title)) {
            MuscleTrendView(logs = logs, today = d.today, uk = uk)
        }
    }

    item {
        ProgressCard(stringResource(Res.string.pr_proof_progress_title)) {
            RecordsView(s.records, uk)
        }
    }

    item { trainExtras() }
}

@Composable
private fun CalendarCard(vm: ProgressViewModel, s: ProgressViewModel.State, d: ProgressDashboard) {
    val uk = d.uk()
    val days = d.calendar.days.takeLast(35)
    val doneCount = d.calendar.days.count { it.status == "done" }
    ProgressCard(stringResource(Res.string.pr_activity_calendar_title)) {
        MutedText(stringResource(Res.string.pr_calendar_done_count, doneCount))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            days.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    week.forEach { day ->
                        val color = when (day.status) {
                            "done" -> MaterialTheme.colorScheme.primary
                            "missed" -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                        val selected = s.selectedDay == day.date
                        Box(
                            Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(color)
                                .then(if (day.date == d.today) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, RoundedCornerShape(8.dp)) else Modifier)
                                .then(if (selected) Modifier.border(2.dp, MaterialTheme.colorScheme.tertiary, RoundedCornerShape(8.dp)) else Modifier)
                                .clickable { vm.openDay(day.date) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(day.date.takeLast(2).toInt().toString(), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LegendDot(MaterialTheme.colorScheme.primary, stringResource(Res.string.pr_done_label))
            LegendDot(MaterialTheme.colorScheme.error, stringResource(Res.string.pr_missed_label))
        }
        val selectedDay = s.selectedDay
        if (selectedDay != null) DayDetail(d, s, selectedDay, uk)
    }
}

@Composable
private fun LegendDot(color: androidx.compose.ui.graphics.Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Swatch(color)
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun DayDetail(d: ProgressDashboard, s: ProgressViewModel.State, date: String, uk: Boolean) {
    val status = d.calendar.days.firstOrNull { it.date == date }?.status
    val kg = stringResource(Res.string.pr_unit_kg)
    val cm = stringResource(Res.string.pr_unit_cm)
    val macro = d.macros.days.firstOrNull { it.date == date }
    val weight = d.weight.points.firstOrNull { it.date == date }
    val measurements = d.measurements.flatMap { m -> m.points.filter { it.date == date }.map { measureLabel(m.key) to it.v } }
    Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(shortDate(date, uk), fontWeight = FontWeight.SemiBold)
            status?.let {
                Text(
                    stringResource(
                        when (it) {
                            "done" -> Res.string.pr_done_label
                            "missed" -> Res.string.pr_missed_label
                            else -> Res.string.pr_recovery_label
                        },
                    ),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        Text(stringResource(Res.string.pr_day_detail_workout_title), fontWeight = FontWeight.SemiBold)
        val floor = isoPlusDays(d.today, -14)
        when {
            date < floor -> MutedText(stringResource(Res.string.pr_day_detail_unavailable))
            s.dayDetailBusy -> MutedText(stringResource(Res.string.pr_saving_ellipsis))
            s.dayDetailFailed -> MutedText(stringResource(Res.string.pr_generic_error))
            (s.dayDetail?.saved ?: emptyList<DayWorkout.SavedExercise>()).isNotEmpty() -> Column {
                s.dayDetail?.saved?.forEach { saved -> Text("${saved.name} · ${saved.sets.size}×", style = MaterialTheme.typography.bodyMedium) }
            }
            else -> MutedText(stringResource(Res.string.pr_day_detail_no_log))
        }
        Text(stringResource(Res.string.pr_day_detail_macros_title), fontWeight = FontWeight.SemiBold)
        if (macro != null) {
            MutedText(
                stringResource(Res.string.pr_macro_line, formatNumber(macro.p, uk), formatNumber(macro.f, uk), formatNumber(macro.c, uk)) +
                    " · ${jsRound(macro.kcal).toLong()} ${stringResource(Res.string.pr_kcal_unit)}",
            )
        } else {
            MutedText(stringResource(Res.string.pr_day_detail_no_macros))
        }
        if (weight != null || measurements.isNotEmpty()) {
            Text(stringResource(Res.string.pr_day_detail_measure_title), fontWeight = FontWeight.SemiBold)
            val parts = buildList {
                weight?.let { add("${formatNumber(it.kg, uk)} $kg") }
                measurements.forEach { (label, v) -> add("$label ${formatNumber(v, uk)} $cm") }
            }
            MutedText(parts.joinToString(" · "))
        }
    }
}

@Composable
private fun EmptyNote(title: String, detail: String) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("—", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, fontWeight = FontWeight.SemiBold)
        MutedText(detail)
    }
}

// ---- Body tab ----

private fun LazyListScope.bodyTab(vm: ProgressViewModel, s: ProgressViewModel.State, d: ProgressDashboard) {
    val uk = d.uk()
    item { WellbeingCard(refreshKey = d) }
    item {
        ProgressCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(Res.string.pr_weight_trend_eyebrow_plain), fontWeight = FontWeight.SemiBold)
                val projection = d.weight.projection
                val label = when {
                    projection?.reached == true -> stringResource(Res.string.pr_goal_reached)
                    projection?.onTrack == true -> stringResource(Res.string.pr_on_track)
                    else -> ""
                }
                if (label.isNotEmpty()) MutedText(label)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(7 to Res.string.pr_period_week, 30 to Res.string.pr_period_month, 90 to Res.string.pr_period_3m).forEach { (days, res) ->
                    FilterChip(selected = s.weightPeriod == days, onClick = { vm.selectWeightPeriod(days) }, label = { Text(stringResource(res)) })
                }
            }
            val from = isoPlusDays(d.today, -(s.weightPeriod - 1))
            val periodPoints = d.weight.points.filter { it.date >= from }
            if (periodPoints.size > 1) {
                WeightChartView(periodPoints, d.weight.goal, d.weight.projection?.slopePerWeek, uk)
            } else {
                MutedText(stringResource(Res.string.pr_build_baseline_detail))
            }
            d.bodyFat?.let { MutedText("${stringResource(Res.string.pr_metric_body_fat)}: ${formatNumber(it.pct, uk)}%") }
        }
    }

    if (d.measurements.isNotEmpty()) item {
        ProgressCard(stringResource(Res.string.pr_measurements_title)) {
            val active = d.measurements.firstOrNull { it.key == s.measureKey } ?: d.measurements.first()
            SelectField(
                stringResource(Res.string.pr_measurements_pick_key_label),
                measureLabel(active.key),
                d.measurements.map { it.key to measureLabel(it.key) },
            ) { vm.selectMeasureKey(it) }
            LineChart(active.points.map { ChartPoint(it.date, it.v) }, MaterialTheme.colorScheme.tertiary)
        }
    }

    item {
        ProgressCard(stringResource(Res.string.pr_log_today_title)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = s.measureInput,
                    onValueChange = vm::onMeasureInput,
                    label = { Text(stringResource(Res.string.pr_qt_body_label)) },
                    placeholder = { Text(stringResource(Res.string.pr_measure_ph)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = vm::saveMeasure,
                    enabled = s.measureInput.isNotBlank() && s.busy == null,
                ) { Text(if (s.busy == "measure") stringResource(Res.string.pr_saving_ellipsis) else stringResource(Res.string.pr_save_measure_btn)) }
            }
            Text(stringResource(Res.string.pr_qt_checkin_label), fontWeight = FontWeight.SemiBold)
            MutedText(stringResource(Res.string.pr_qt_checkin_hint))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CheckinPicker(stringResource(Res.string.pr_energy_label), s.checkin.energy, Modifier.weight(1f)) { vm.onCheckin(s.checkin.copy(energy = it)) }
                CheckinPicker(stringResource(Res.string.pr_sleep_label), s.checkin.sleep, Modifier.weight(1f)) { vm.onCheckin(s.checkin.copy(sleep = it)) }
                CheckinPicker(stringResource(Res.string.pr_stress_label), s.checkin.stress, Modifier.weight(1f)) { vm.onCheckin(s.checkin.copy(stress = it)) }
            }
            OutlinedButton(
                onClick = vm::saveCheckin,
                enabled = s.busy == null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (s.busy == "checkin") stringResource(Res.string.pr_saving_ellipsis) else stringResource(Res.string.pr_save_checkin_btn)) }
            NoticeLine(s.notice)
        }
    }

    item {
        ProgressCard(stringResource(Res.string.pr_progress_photo_upload_title)) {
            PhotoPairView(s.photos, d.weight.points, vm::photoUrl, s.bearer, uk)
            MutedText(stringResource(Res.string.pr_progress_photo_upload_hint))
            OutlinedButton(onClick = vm::addPhoto, enabled = s.busy == null, modifier = Modifier.fillMaxWidth()) {
                Text(if (s.busy == "photo") stringResource(Res.string.pr_saving_ellipsis) else stringResource(Res.string.pr_progress_photo_upload_btn))
            }
            if (s.notice == ProgressNotice.PHOTO_SAVED) MutedText(stringResource(Res.string.pr_progress_photo_uploaded_note))
        }
    }
}

@Composable
private fun CheckinPicker(label: String, value: Int, modifier: Modifier, onPick: (Int) -> Unit) {
    Column(modifier) {
        SelectField(label, "$value/5", (1..5).map { it.toString() to "$it/5" }) { onPick(it.toInt()) }
    }
}

@Composable
private fun NoticeLine(notice: ProgressNotice?) {
    when (notice) {
        ProgressNotice.SAVED -> MutedText(stringResource(Res.string.pr_progress_saved_note))
        ProgressNotice.FAILED -> Text(stringResource(Res.string.pr_generic_error), color = MaterialTheme.colorScheme.error)
        else -> Unit
    }
}

// ---- Food tab ----

private fun LazyListScope.foodTab(d: ProgressDashboard) {
    val uk = d.uk()
    val today = d.macros.days.lastOrNull()
    item {
        ProgressCard(stringResource(Res.string.pr_macro_breakdown_title)) {
            val pCal = (today?.p ?: 0.0) * 4
            val fCal = (today?.f ?: 0.0) * 9
            val cCal = (today?.c ?: 0.0) * 4
            val total = (pCal + fCal + cCal).takeIf { it > 0 } ?: 1.0
            if (today == null || (today.p == 0.0 && today.f == 0.0 && today.c == 0.0)) {
                MutedText(stringResource(Res.string.pr_macro_breakdown_empty))
            } else {
                val (targets, rest) = targetsForDay(today.training, d.macros)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    MacroDonut(
                        proteinPct = (pCal / total * 100).toFloat(),
                        fatPct = (fCal / total * 100).toFloat(),
                        carbPct = (cCal / total * 100).toFloat(),
                        protein = MaterialTheme.colorScheme.tertiary,
                        fat = MaterialTheme.colorScheme.secondary,
                        carb = MaterialTheme.colorScheme.primary,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(jsRound(today.kcal).toLong().toString(), fontWeight = FontWeight.Bold)
                            Text(stringResource(Res.string.pr_kcal_unit), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        LegendLine(MaterialTheme.colorScheme.tertiary, "${stringResource(Res.string.pr_metric_protein)} · ${formatNumber(today.p, uk)} ${stringResource(Res.string.pr_unit_g)}")
                        LegendLine(MaterialTheme.colorScheme.secondary, "${stringResource(Res.string.pr_metric_fats)} · ${formatNumber(today.f, uk)} ${stringResource(Res.string.pr_unit_g)}")
                        LegendLine(MaterialTheme.colorScheme.primary, "${stringResource(Res.string.pr_metric_carbs)} · ${formatNumber(today.c, uk)} ${stringResource(Res.string.pr_unit_g)}")
                        targets?.let {
                            var line = stringResource(Res.string.pr_kcal_of_target, jsRound(today.kcal).toLong(), jsRound(it.calories).toLong())
                            if (rest) line += " · ${stringResource(Res.string.pr_fuel_rest_day_badge)}"
                            MutedText(line)
                        }
                    }
                }
            }
        }
    }
    item {
        ProgressCard(stringResource(Res.string.pr_macro_trend_title)) {
            val history = macroHistory(d.macros)
            if (history.isEmpty()) {
                MutedText(stringResource(Res.string.pr_macro_empty))
            } else {
                history.forEach { (day, pct) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(shortDate(day.date, uk), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(0.35f))
                        LinearProgressIndicator(progress = { pct / 100f }, modifier = Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)))
                        Text("${jsRound(day.kcal).toLong()} ${stringResource(Res.string.pr_kcal_unit)}", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun LegendLine(color: androidx.compose.ui.graphics.Color, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Swatch(color)
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

