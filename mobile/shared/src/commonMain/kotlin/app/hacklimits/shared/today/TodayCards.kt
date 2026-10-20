package app.hacklimits.shared.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.resources.*
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

// The Today cards, one per Mini App block (Today.tsx, Week.tsx). Copy comes from strings_today.xml.

@Composable
internal fun ExercisesLabel(lang: String, n: Int): String {
    if (lang == "en") return stringResource(if (n == 1) Res.string.td_ex_count_one else Res.string.td_ex_count_many, n)
    val mod10 = n % 10
    val mod100 = n % 100
    val res = when {
        mod10 == 1 && mod100 != 11 -> Res.string.td_ex_count_one
        mod10 in 2..4 && (mod100 < 12 || mod100 > 14) -> Res.string.td_ex_count_few
        else -> Res.string.td_ex_count_many
    }
    return stringResource(res, n)
}

/** The workout block: one main action for start, continue, the logged day, or a rest day. */
@Composable
internal fun WorkoutBlock(plan: TodayPlan, lang: String, group: String?, minutes: Int, onClick: () -> Unit) {
    val primary = plan.state == TodayState.Start || plan.state == TodayState.Continue
    val n = plan.exercises.size
    val kicker = stringResource(if (plan.state == TodayState.Continue) Res.string.td_in_progress else Res.string.td_kicker)
    val kickerLine = if (plan.state == TodayState.Done && group != null) "$kicker · $group" else kicker
    val title = when (plan.state) {
        TodayState.Done -> stringResource(Res.string.td_done_title)
        TodayState.Rest -> stringResource(Res.string.td_rest_title)
        else -> group?.takeIf { it.isNotBlank() } ?: stringResource(Res.string.td_workout_title)
    }
    val meta = when (plan.state) {
        TodayState.Rest -> stringResource(Res.string.td_rest_body)
        TodayState.Done -> stringResource(Res.string.td_done_meta, plan.sets)
        TodayState.Continue -> stringResource(Res.string.td_continue_meta, plan.started, n)
        TodayState.Start -> if (minutes > 0) "${ExercisesLabel(lang, n)} · ${stringResource(Res.string.td_about_min, minutes)}" else ExercisesLabel(lang, n)
    }
    val action = stringResource(
        when (plan.state) {
            TodayState.Start -> Res.string.td_start_session
            TodayState.Continue -> Res.string.td_continue_btn
            TodayState.Done -> Res.string.td_view_log_btn
            TodayState.Rest -> Res.string.td_log_workout
        },
    )
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(kickerLine, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (plan.state != TodayState.Rest && n > 0) {
                // Wraps: long exercise names in a Row squeezed the last pill into a one-letter column.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    plan.exercises.take(3).forEach { name ->
                        Pill(name, MaterialTheme.colorScheme.surfaceContainerHigh)
                    }
                    if (n > 3) Pill("+${n - 3}", MaterialTheme.colorScheme.surfaceContainerHigh)
                }
            }
            if (primary) {
                Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(action) }
            } else {
                OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(action) }
            }
        }
    }
}

@Composable
private fun Pill(text: String, color: Color) {
    Box(Modifier.clip(RoundedCornerShape(50)).background(color).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(text, style = MaterialTheme.typography.labelMedium)
    }
}

/** "Your chest is still recovering -- swap today with Thursday's legs?" One tap trades the two days. */
@Composable
internal fun RecoverySwapCard(lang: String, swap: Dashboard.RecoverySwap, onSwap: suspend (Int, Int) -> Unit, onDone: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var dismissed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    if (dismissed) return
    val muscles = StringBuilder()
    for (slug in swap.tired) {
        if (muscles.isNotEmpty()) muscles.append(", ")
        muscles.append(muscleLabel(slug).lowercase())
    }
    val other = stringResource(weekdayRes(swap.other))
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.td_rswap_title, muscles.toString()), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                stringResource(Res.string.td_rswap_body, swap.because.joinToString(", "), swap.todayGroup, other, swap.otherGroup),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (failed) Text(stringResource(Res.string.td_error), color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !busy, onClick = {
                    scope.launch {
                        busy = true
                        failed = false
                        try {
                            onSwap(swap.weekday, swap.other)
                            onDone()
                        } catch (e: Exception) {
                            failed = true
                        } finally {
                            busy = false
                        }
                    }
                }) { Text(stringResource(if (busy) Res.string.td_saving else Res.string.td_rswap_btn, other)) }
                TextButton(enabled = !busy, onClick = { dismissed = true }) { Text(stringResource(Res.string.td_rswap_keep)) }
            }
        }
    }
}

/** Seven days of this week: done (check), missed, planned, rest; today is labelled. */
@Composable
internal fun WeekStrip(week: List<PlanDay>) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        week.forEach { day ->
            val dayName = stringResource(weekdayRes(day.weekday))
            val markName = stringResource(
                when (day.mark) {
                    DayMark.Done -> Res.string.td_day_done
                    DayMark.Missed -> Res.string.td_day_missed
                    DayMark.Planned -> Res.string.td_day_planned
                    DayMark.Rest -> Res.string.td_day_rest
                },
            )
            val container = when (day.mark) {
                DayMark.Done -> MaterialTheme.colorScheme.primaryContainer
                DayMark.Missed -> MaterialTheme.colorScheme.errorContainer
                DayMark.Planned -> MaterialTheme.colorScheme.surfaceContainerHighest
                DayMark.Rest -> MaterialTheme.colorScheme.surfaceContainerLow
            }
            Column(
                Modifier.weight(1f).semantics { contentDescription = "$dayName: $markName" },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    dayName,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (day.today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (day.today) FontWeight.Bold else FontWeight.Normal,
                )
                Box(
                    Modifier.padding(top = 4.dp).fillMaxWidth().height(36.dp).clip(RoundedCornerShape(8.dp)).background(container),
                    contentAlignment = Alignment.Center,
                ) {
                    if (day.mark == DayMark.Done) Text("✓", color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
    }
}

@Composable
internal fun Notice(text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Text(text, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable
private fun Meter(label: String, value: Double, goal: Double, text: String) {
    val fraction = (value / maxOf(1.0, goal)).coerceIn(0.0, 1.0).toFloat()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label)
            Text(text)
        }
        LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth())
    }
}

/** Water and steps against their goals, logged right here (+250 / +500 ml, today's steps). */
@Composable
internal fun WaterStepsCard(stats: Dashboard.TodayStats, quick: QuickLogViewModel, onSaved: () -> Unit) {
    val s by quick.state.collectAsStateWithLifecycle()
    // Each finished log reloads the dashboard, so the meters show the saved totals.
    LaunchedEffect(s.done) { if (s.done != null) onSaved() }
    val unitMl = stringResource(Res.string.td_unit_ml)
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(Res.string.td_water_steps), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Meter(
                stringResource(Res.string.td_metric_water), stats.waterMl, stats.waterGoal,
                stringResource(Res.string.td_water_of_goal, formatDecimal(stats.waterMl), formatDecimal(stats.waterGoal), unitMl),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !s.busy, onClick = { quick.addWater(250) }) { Text(stringResource(Res.string.td_add_water, 250, unitMl)) }
                OutlinedButton(enabled = !s.busy, onClick = { quick.addWater(500) }) { Text(stringResource(Res.string.td_add_water, 500, unitMl)) }
            }
            Meter(
                stringResource(Res.string.td_metric_steps), stats.steps.toDouble(), stats.stepsGoal.toDouble(),
                stringResource(Res.string.td_steps_of_goal, formatDecimal(stats.steps.toDouble()), formatDecimal(stats.stepsGoal.toDouble())),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = s.steps,
                    onValueChange = quick::onSteps,
                    placeholder = { Text(stringResource(Res.string.td_steps_ph)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
                Button(enabled = s.steps.isNotBlank() && !s.busy, onClick = quick::saveSteps) {
                    Text(stringResource(if (s.busy) Res.string.td_saving else Res.string.td_save_steps))
                }
            }
            if (s.failed) Text(stringResource(Res.string.td_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun recoveryLabelRes(label: String): StringResource = when (label) {
    "great" -> Res.string.td_recovery_great
    "good" -> Res.string.td_recovery_good
    "poor" -> Res.string.td_recovery_poor
    else -> Res.string.td_recovery_fair
}

@Composable
internal fun RecoveryPill(recovery: Dashboard.Recovery) {
    val color = when {
        recovery.score >= 70 -> MaterialTheme.colorScheme.primaryContainer
        recovery.score >= 45 -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.errorContainer
    }
    Pill(stringResource(recoveryLabelRes(recovery.label)), color)
}

/** Recovery score, and up to three reasons it is not higher (the codes come from the server). */
@Composable
internal fun RecoveryDetailsCard(recovery: Dashboard.Recovery) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(Res.string.td_metric_recovery), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("${recovery.score}", fontWeight = FontWeight.Bold)
            }
            if (recovery.factors.isEmpty()) {
                Text(stringResource(Res.string.td_no_recovery_blockers), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                recovery.factors.take(3).forEach { factor ->
                    Text("• ${factorText(factor)}")
                }
            }
        }
    }
}

@Composable
private fun factorText(factor: Dashboard.Recovery.Factor): String = when (factor.code) {
    "volume_above" -> stringResource(Res.string.td_factor_volume_above, factor.count)
    "cardio_above" -> stringResource(Res.string.td_factor_cardio_above)
    "low_energy" -> stringResource(Res.string.td_factor_low_energy)
    "high_stress" -> stringResource(Res.string.td_factor_high_stress)
    "poor_sleep" -> stringResource(Res.string.td_factor_poor_sleep)
    "grinding_rpe" -> stringResource(Res.string.td_factor_grinding_rpe)
    else -> factor.code
}

/** The muscle group's display name for a slug like "lower-back" (the Mini App's muscle_* keys). */
@Composable
internal fun muscleLabel(slug: String): String {
    val res = muscleRes(slug) ?: return slug
    return stringResource(res)
}

private fun muscleRes(slug: String): StringResource? = when (slug.replace("-", "_")) {
    "abs" -> Res.string.td_muscle_abs
    "adductors" -> Res.string.td_muscle_adductors
    "biceps" -> Res.string.td_muscle_biceps
    "calves" -> Res.string.td_muscle_calves
    "chest" -> Res.string.td_muscle_chest
    "deltoids" -> Res.string.td_muscle_deltoids
    "forearm" -> Res.string.td_muscle_forearm
    "gluteal" -> Res.string.td_muscle_gluteal
    "hamstring" -> Res.string.td_muscle_hamstring
    "lower_back" -> Res.string.td_muscle_lower_back
    "neck" -> Res.string.td_muscle_neck
    "obliques" -> Res.string.td_muscle_obliques
    "quadriceps" -> Res.string.td_muscle_quadriceps
    "tibialis" -> Res.string.td_muscle_tibialis
    "trapezius" -> Res.string.td_muscle_trapezius
    "triceps" -> Res.string.td_muscle_triceps
    "upper_back" -> Res.string.td_muscle_upper_back
    else -> null
}

private fun weekdayRes(weekday: Int): StringResource = when (weekday) {
    1 -> Res.string.td_weekday_mon
    2 -> Res.string.td_weekday_tue
    3 -> Res.string.td_weekday_wed
    4 -> Res.string.td_weekday_thu
    5 -> Res.string.td_weekday_fri
    6 -> Res.string.td_weekday_sat
    else -> Res.string.td_weekday_sun
}

/** Balance score, the run of balanced weeks towards the badge, and the week's quests (dashboard.week). */
@Composable
internal fun WeekCardView(lang: String, week: Dashboard.Week) {
    val goal = maxOf(1, week.balanceGoal)
    val streak = minOf(week.balanceStreak, goal)
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text(stringResource(Res.string.td_week_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(stringResource(Res.string.td_week_card_title, week.balance), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                Pill("$streak/${goal}", MaterialTheme.colorScheme.surfaceContainerHigh)
            }
            Text(stringResource(Res.string.td_week_streak, week.balanceStreak, goal), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LinearProgressIndicator(progress = { streak.toFloat() / goal }, modifier = Modifier.fillMaxWidth())
            if (week.quests.isNotEmpty()) {
                Text(stringResource(Res.string.td_quests_title, week.questXp), fontWeight = FontWeight.SemiBold)
                week.quests.forEach { q ->
                    val target = maxOf(1.0, q.target)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(if (q.done) "✓" else "", color = MaterialTheme.colorScheme.primary, modifier = Modifier.height(24.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(questText(q), fontWeight = FontWeight.Medium)
                            LinearProgressIndicator(progress = { (q.current / target).coerceIn(0.0, 1.0).toFloat() }, modifier = Modifier.fillMaxWidth())
                        }
                        val shown = minOf(q.current, q.target)
                        val shownText = if (lang == "uk") formatHalf(shown).replace('.', ',') else formatHalf(shown)
                        Text("$shownText/${q.target.toInt()}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun questText(q: Dashboard.Week.Quest): String = when (q.kind) {
    "muscle_sets" -> stringResource(Res.string.td_quest_muscle_sets, muscleLabel(q.muscle ?: ""), q.target.toInt())
    "workouts" -> stringResource(Res.string.td_quest_workouts, q.target.toInt())
    "balance" -> stringResource(Res.string.td_quest_balance, q.target.toInt())
    "water_days" -> stringResource(Res.string.td_quest_water_days, q.target.toInt())
    "food_days" -> stringResource(Res.string.td_quest_food_days, q.target.toInt())
    "steps_days" -> stringResource(Res.string.td_quest_steps_days, q.target.toInt())
    else -> q.kind
}

/** Last week in one card until dismissed (see lastWeekSummary). */
@Composable
internal fun WeekSummaryCard(lang: String, summary: WeekSummary, onClose: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column {
                    Text(stringResource(Res.string.td_ws_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(stringResource(Res.string.td_ws_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                TextButton(onClick = onClose) { Text(stringResource(Res.string.td_close)) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                SummaryStat(if (summary.planned > 0) "${summary.workouts}/${summary.planned}" else "${summary.workouts}", stringResource(Res.string.td_ws_workouts))
                SummaryStat(summary.weightDelta?.let { formatKgDelta(it) } ?: "—", stringResource(Res.string.td_ws_weight))
                SummaryStat("${summary.foodDays}/7", stringResource(Res.string.td_ws_food))
            }
            if (summary.records.isNotEmpty()) {
                Text(stringResource(Res.string.td_ws_records, summary.records.take(3).joinToString(", ")), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val focus = when (summary.focus) {
                WeekFocus.Workouts -> stringResource(Res.string.td_ws_focus_workouts, summary.planned)
                WeekFocus.Weigh -> stringResource(Res.string.td_ws_focus_weigh)
                WeekFocus.Food -> stringResource(Res.string.td_ws_focus_food)
                WeekFocus.Keep -> stringResource(Res.string.td_ws_focus_keep)
            }
            Text("${stringResource(Res.string.td_ws_focus_label)} $focus")
        }
    }
}

@Composable
private fun SummaryStat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Badges earned since the app last showed them. */
@Composable
internal fun BadgeCelebration(badges: List<Dashboard.Badge>, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.td_badge_ok)) } },
        title = { Text(stringResource(if (badges.size > 1) Res.string.td_badge_new_many else Res.string.td_badge_new_one)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                badges.forEach { Text(it.label) }
            }
        },
    )
}
