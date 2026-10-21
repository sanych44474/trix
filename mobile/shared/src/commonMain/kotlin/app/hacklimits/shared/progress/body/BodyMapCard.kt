package app.hacklimits.shared.progress.body

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.TrainingPlanDay
import app.hacklimits.shared.progress.muscle.ExerciseMuscles
import app.hacklimits.shared.progress.muscle.LoggedDay
import app.hacklimits.shared.progress.muscle.MuscleRecovery
import app.hacklimits.shared.progress.muscle.MuscleWeek
import app.hacklimits.shared.progress.muscle.isoPlusDays
import app.hacklimits.shared.progress.muscle.lopsidedPairs
import app.hacklimits.shared.progress.muscle.muscleRecovery
import app.hacklimits.shared.progress.muscle.musclesForExercise
import app.hacklimits.shared.progress.muscle.weekBalance
import app.hacklimits.shared.progress.muscle.weeklyMuscleSets
import app.hacklimits.shared.progress.ui.SelectField
import app.hacklimits.shared.progress.ui.formatNumber
import app.hacklimits.shared.progress.ui.groupLabel
import app.hacklimits.shared.progress.ui.muscleLabel
import app.hacklimits.shared.progress.ui.weekdayLabel
import app.hacklimits.shared.progress.ui.zoneLabel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_body_map_back
import app.hacklimits.shared.resources.pr_body_map_day_assists
import app.hacklimits.shared.resources.pr_body_map_day_detail
import app.hacklimits.shared.resources.pr_body_map_day_drives
import app.hacklimits.shared.resources.pr_body_map_day_unknown
import app.hacklimits.shared.resources.pr_body_map_exercise_detail
import app.hacklimits.shared.resources.pr_body_map_exercise_primary_only
import app.hacklimits.shared.resources.pr_body_map_front
import app.hacklimits.shared.resources.pr_body_map_hint
import app.hacklimits.shared.resources.pr_body_map_mode_recovery
import app.hacklimits.shared.resources.pr_body_map_mode_week
import app.hacklimits.shared.resources.pr_body_map_pick_label
import app.hacklimits.shared.resources.pr_body_map_primary
import app.hacklimits.shared.resources.pr_body_map_role_none
import app.hacklimits.shared.resources.pr_body_map_role_primary
import app.hacklimits.shared.resources.pr_body_map_role_secondary
import app.hacklimits.shared.resources.pr_body_map_secondary
import app.hacklimits.shared.resources.pr_body_map_unknown_exercise
import app.hacklimits.shared.resources.pr_body_map_whole_day
import app.hacklimits.shared.resources.pr_body_map_recent_group
import app.hacklimits.shared.resources.pr_days_ago_0
import app.hacklimits.shared.resources.pr_days_ago_1
import app.hacklimits.shared.resources.pr_days_ago_n
import app.hacklimits.shared.resources.pr_recovery_all_ready
import app.hacklimits.shared.resources.pr_recovery_almost
import app.hacklimits.shared.resources.pr_recovery_detail_none
import app.hacklimits.shared.resources.pr_recovery_detail_primary
import app.hacklimits.shared.resources.pr_recovery_detail_secondary
import app.hacklimits.shared.resources.pr_recovery_legend_almost
import app.hacklimits.shared.resources.pr_recovery_legend_ready
import app.hacklimits.shared.resources.pr_recovery_legend_recovering
import app.hacklimits.shared.resources.pr_recovery_ready
import app.hacklimits.shared.resources.pr_recovery_recovering
import app.hacklimits.shared.resources.pr_recovery_summary_almost
import app.hacklimits.shared.resources.pr_recovery_summary_tired
import app.hacklimits.shared.resources.pr_week_balance_score
import app.hacklimits.shared.resources.pr_week_lopsided
import app.hacklimits.shared.resources.pr_week_muscle_assist_short
import app.hacklimits.shared.resources.pr_week_muscle_detail
import app.hacklimits.shared.resources.pr_week_muscle_detail_nomev
import app.hacklimits.shared.resources.pr_week_muscle_none
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

// The Progress screen's body map: the anatomical front and back figures coloured by the selected
// view (this week's load, recovery, a training day, or one exercise), a picker to choose the view,
// the legend, and a line that explains the tapped muscle. Port of BodyMap.tsx.

private val LEGEND_ZONES = listOf("below", "optimal", "above")
private val LEGEND_RECOVERY = listOf("recovering", "almost", "ready")

/** Selection keys, as the Mini App's dropdown values: "" week, "r" recovery, "d:<weekday>", "e:<exercise>". */
private fun rawNumber(d: Double): String = if (d % 1.0 == 0.0) d.toInt().toString() else d.toString()

@Composable
fun BodyMapCard(
    male: Boolean,
    logs: List<LoggedDay>,
    today: String,
    planDays: List<TrainingPlanDay>,
    recentNames: List<String>,
    uk: Boolean,
    lookup: (String) -> ExerciseMuscles? = ::musclesForExercise,
) {
    var selectionKey by remember { mutableStateOf("") }
    var tapped by remember { mutableStateOf<String?>(null) }
    val weekStart = isoPlusDays(today, -6)
    val week = remember(logs, today) { weeklyMuscleSets(logs, weekStart, lookup) }
    val recovery = remember(logs, today) { muscleRecovery(logs, today, lookup) }
    val balance = remember(logs, today) { weekBalance(logs, weekStart, lookup) }
    val groups = remember(planDays, recentNames) { pickerGroups(planDays, recentNames) }

    val dayGroup = if (selectionKey.startsWith("d:")) groups.firstOrNull { it.weekday == selectionKey.removePrefix("d:").toIntOrNull() } else null
    val exerciseName = if (selectionKey.startsWith("e:")) selectionKey.removePrefix("e:") else null
    val exerciseMuscles = exerciseName?.let(lookup)
    val dayData = dayGroup?.let { dayMuscles(it.dayNames, lookup) }
    val muscleParts: List<BodyPart> = when {
        dayData != null -> dayData.primary.map { BodyPart(it, PRIMARY_COLOR) } + dayData.secondary.map { BodyPart(it, SECONDARY_COLOR) }
        exerciseMuscles != null -> exerciseMuscles.primary.map { BodyPart(it, PRIMARY_COLOR) } + exerciseMuscles.secondary.map { BodyPart(it, SECONDARY_COLOR) }
        else -> emptyList()
    }
    val parts: List<BodyPart> = when {
        selectionKey == "r" -> recovery.map { BodyPart(it.slug, RECOVERY_COLORS.getValue(it.status)) }
        selectionKey.startsWith("d:") || selectionKey.startsWith("e:") -> muscleParts
        else -> week.filter { it.sets > 0 && it.zone != "none" }.map { BodyPart(it.slug, ZONE_COLORS.getValue(it.zone)) }
    }
    val paint = parts.associate { it.slug to it.color }
    val base = MaterialTheme.colorScheme.surfaceVariant
    val border = MaterialTheme.colorScheme.outlineVariant
    val onTap: (String) -> Unit = { slug -> tapped = slug }

    val options = buildList {
        add("" to stringResource(Res.string.pr_body_map_mode_week))
        add("r" to stringResource(Res.string.pr_body_map_mode_recovery))
        for (group in groups) {
            val title = if (group.weekday != null) {
                weekdayLabel(group.weekday) + (if (group.title.isNotEmpty()) " · ${group.title}" else "")
            } else {
                stringResource(Res.string.pr_body_map_recent_group)
            }
            add("#$title" to title)
            if (group.weekday != null) add("d:${group.weekday}" to stringResource(Res.string.pr_body_map_whole_day, title))
            for (name in group.names) add("e:$name" to name)
        }
    }
    val selectedLabel = options.firstOrNull { it.first == selectionKey }?.second ?: stringResource(Res.string.pr_body_map_mode_week)

    val detail = bodyMapDetail(
        selectionKey = selectionKey,
        tapped = tapped,
        week = week,
        recovery = recovery,
        balanceScore = balance.balance,
        trainedSets = balance.trainedSets,
        dayGroupTitle = dayGroup?.let { g -> g.weekday?.let { weekdayLabel(it) + (if (g.title.isNotEmpty()) " · ${g.title}" else "") } },
        dayNames = dayGroup?.dayNames,
        exerciseName = exerciseName,
        exerciseMuscles = exerciseMuscles,
        lookup = lookup,
        uk = uk,
    )

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SelectField(stringResource(Res.string.pr_body_map_pick_label), selectedLabel, options) { key ->
            selectionKey = key
            tapped = null
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                BodyFigure(male = male, front = true, colors = paint, base = base, border = border, onTap = onTap, modifier = Modifier.fillMaxWidth())
                Text(stringResource(Res.string.pr_body_map_front), style = MaterialTheme.typography.labelSmall)
            }
            Column(Modifier.weight(1f), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                BodyFigure(male = male, front = false, colors = paint, base = base, border = border, onTap = onTap, modifier = Modifier.fillMaxWidth())
                Text(stringResource(Res.string.pr_body_map_back), style = MaterialTheme.typography.labelSmall)
            }
        }
        Legend(selectionKey)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Legend(selectionKey: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            selectionKey == "r" -> LEGEND_RECOVERY.forEach { status ->
                LegendItem(RECOVERY_COLORS.getValue(status), stringResource(recoveryLegendRes(status)))
            }
            selectionKey.startsWith("d:") || selectionKey.startsWith("e:") -> {
                LegendItem(PRIMARY_COLOR, stringResource(Res.string.pr_body_map_primary))
                LegendItem(SECONDARY_COLOR, stringResource(Res.string.pr_body_map_secondary))
            }
            else -> LEGEND_ZONES.forEach { zone -> LegendItem(ZONE_COLORS.getValue(zone), zoneLabel(zone)) }
        }
    }
}

@Composable
private fun LegendItem(color: Color, label: String) {
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        app.hacklimits.shared.progress.ui.Swatch(color)
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

private fun recoveryLegendRes(status: String): StringResource = when (status) {
    "recovering" -> Res.string.pr_recovery_legend_recovering
    "almost" -> Res.string.pr_recovery_legend_almost
    else -> Res.string.pr_recovery_legend_ready
}

private fun recoveryStatusRes(status: String): StringResource = when (status) {
    "recovering" -> Res.string.pr_recovery_recovering
    "almost" -> Res.string.pr_recovery_almost
    else -> Res.string.pr_recovery_ready
}

@Composable
private fun bodyMapDetail(
    selectionKey: String,
    tapped: String?,
    week: List<MuscleWeek>,
    recovery: List<MuscleRecovery>,
    balanceScore: Int,
    trainedSets: Double,
    dayGroupTitle: String?,
    dayNames: List<String>?,
    exerciseName: String?,
    exerciseMuscles: ExerciseMuscles?,
    lookup: (String) -> ExerciseMuscles?,
    uk: Boolean,
): String {
    val num: (Double) -> String = { formatNumber(it, uk) }
    @Composable
    fun names(slugs: List<String>): String = slugs.map { muscleLabel(it) }.joinToString(", ")

    // A training day: which of its exercises drive or assist the tapped muscle.
    if (dayNames != null && dayGroupTitle != null) {
        val day = dayMuscles(dayNames, lookup)
        if (tapped != null) {
            val drive = dayNames.filter { lookup(it)?.primary?.contains(tapped) == true }
            val assist = dayNames.filter { lookup(it)?.secondary?.contains(tapped) == true }.filter { it !in drive }
            if (drive.isEmpty() && assist.isEmpty()) return "${muscleLabel(tapped)} — ${stringResource(Res.string.pr_body_map_role_none)}"
            val parts = buildList {
                if (drive.isNotEmpty()) add(stringResource(Res.string.pr_body_map_day_drives, drive.joinToString(", ")))
                if (assist.isNotEmpty()) add(stringResource(Res.string.pr_body_map_day_assists, assist.joinToString(", ")))
            }
            return "${muscleLabel(tapped)}: ${parts.joinToString("; ")}."
        }
        val head = stringResource(Res.string.pr_body_map_day_detail, dayGroupTitle, dayNames.size)
        val body = when {
            day.primary.isEmpty() -> ""
            day.secondary.isNotEmpty() -> stringResource(Res.string.pr_body_map_exercise_detail, names(day.primary), names(day.secondary))
            else -> stringResource(Res.string.pr_body_map_exercise_primary_only, names(day.primary))
        }
        val unknown = if (day.unknown.isNotEmpty()) stringResource(Res.string.pr_body_map_day_unknown, day.unknown.joinToString(", ")) else ""
        return listOf(head, body, unknown).filter { it.isNotEmpty() }.joinToString(" ")
    }

    // One exercise: its primary movers and helpers, or the tapped muscle's role in it.
    if (exerciseName != null) {
        val m = exerciseMuscles ?: return stringResource(Res.string.pr_body_map_unknown_exercise, exerciseName)
        if (tapped != null) {
            val role = when {
                tapped in m.primary -> stringResource(Res.string.pr_body_map_role_primary)
                tapped in m.secondary -> stringResource(Res.string.pr_body_map_role_secondary)
                else -> stringResource(Res.string.pr_body_map_role_none)
            }
            return "${muscleLabel(tapped)} — $role"
        }
        return if (m.secondary.isNotEmpty()) stringResource(Res.string.pr_body_map_exercise_detail, names(m.primary), names(m.secondary))
        else stringResource(Res.string.pr_body_map_exercise_primary_only, names(m.primary))
    }

    if (selectionKey == "r") {
        if (tapped != null) {
            val m = recovery.firstOrNull { it.slug == tapped } ?: return muscleLabel(tapped)
            val days = m.daysAgo ?: return stringResource(Res.string.pr_recovery_detail_none, muscleLabel(tapped))
            val whenText = when (days) {
                0 -> stringResource(Res.string.pr_days_ago_0)
                1 -> stringResource(Res.string.pr_days_ago_1)
                else -> stringResource(Res.string.pr_days_ago_n, days)
            }
            val status = stringResource(recoveryStatusRes(m.status))
            val exercises = m.exercises.joinToString(", ")
            return stringResource(
                if (m.primary == true) Res.string.pr_recovery_detail_primary else Res.string.pr_recovery_detail_secondary,
                muscleLabel(tapped), whenText, exercises, status,
            )
        }
        val tired = recovery.filter { it.status == "recovering" }.map { it.slug }
        val almost = recovery.filter { it.status == "almost" }.map { it.slug }
        if (tired.isEmpty() && almost.isEmpty()) return stringResource(Res.string.pr_recovery_all_ready)
        return listOf(
            if (tired.isNotEmpty()) stringResource(Res.string.pr_recovery_summary_tired, names(tired)) else "",
            if (almost.isNotEmpty()) stringResource(Res.string.pr_recovery_summary_almost, names(almost)) else "",
        ).filter { it.isNotEmpty() }.joinToString(" ")
    }

    // This week: the tapped muscle's sets and exercises, else the balance score and lopsided pairs.
    if (tapped != null) {
        val m = week.firstOrNull { it.slug == tapped } ?: return muscleLabel(tapped)
        if (m.sets <= 0) return stringResource(Res.string.pr_week_muscle_none, muscleLabel(tapped))
        val assistShort = stringResource(Res.string.pr_week_muscle_assist_short)
        val list = m.exercises.map { e ->
            "${e.name} ×${rawNumber(e.sets)}" + if (e.secondary) " ($assistShort)" else ""
        }.joinToString(", ")
        return if (m.mev > 0) {
            stringResource(Res.string.pr_week_muscle_detail, muscleLabel(tapped), num(m.sets), m.mev, m.mav, list)
        } else {
            stringResource(Res.string.pr_week_muscle_detail_nomev, muscleLabel(tapped), num(m.sets), list)
        }
    }
    val setsOf: (String) -> Double = { slug -> week.firstOrNull { it.slug == slug }?.sets ?: 0.0 }
    val score = if (trainedSets > 0) stringResource(Res.string.pr_week_balance_score, balanceScore) + " " else ""
    val lopsided = lopsidedPairs(setsOf)
    if (lopsided.isNotEmpty()) {
        return score + lopsided.map { p ->
            stringResource(Res.string.pr_week_lopsided, muscleLabel(p.weak), num(p.weakSets), muscleLabel(p.strong), num(p.strongSets))
        }.joinToString(" ")
    }
    return score + stringResource(Res.string.pr_body_map_hint)
}
