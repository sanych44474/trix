package app.hacklimits.shared.workout.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_feel_easy
import app.hacklimits.shared.resources.wk_feel_hard
import app.hacklimits.shared.resources.wk_feel_ok
import app.hacklimits.shared.resources.wk_feel_question
import app.hacklimits.shared.resources.wk_generic_error
import app.hacklimits.shared.resources.wk_ph_kg
import app.hacklimits.shared.resources.wk_summary_ask_coach_btn
import app.hacklimits.shared.resources.wk_summary_badges
import app.hacklimits.shared.resources.wk_summary_done_btn
import app.hacklimits.shared.resources.wk_summary_duration
import app.hacklimits.shared.resources.wk_summary_level_up
import app.hacklimits.shared.resources.wk_summary_pr_kicker
import app.hacklimits.shared.resources.wk_summary_pr_more
import app.hacklimits.shared.resources.wk_summary_sets_of
import app.hacklimits.shared.resources.wk_summary_volume
import app.hacklimits.shared.resources.wk_unit_t
import app.hacklimits.shared.workout.FeelState
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.SaveSummary
import app.hacklimits.shared.workout.logic.fmtDuration
import kotlin.math.roundToInt
import kotlin.random.Random
import org.jetbrains.compose.resources.stringResource

/**
 * After a save: what was done (time, sets, volume), a new record when there is one, "how did it go?",
 * and one way out. As a screen it replaces focus mode; otherwise it heads the workout overview.
 */
@Composable
fun SummaryView(
    vm: LoggerViewModel,
    s: LoggerUi,
    summary: SaveSummary,
    title: String,
    subtitle: String,
    onAskCoach: (() -> Unit)?,
    asScreen: Boolean,
) {
    val celebrate = summary.prExercises.isNotEmpty() || summary.leveledUp || summary.newBadges.isNotEmpty()
    val stats = buildList {
        if (summary.elapsedSec > 0) add(fmtDuration(summary.elapsedSec) to stringResource(Res.string.wk_summary_duration))
        add((if (summary.plannedSets > 0) "${summary.sets}/${summary.plannedSets}" else "${summary.sets}") to stringResource(Res.string.wk_summary_sets_of))
        if (summary.volumeKg > 0) {
            val volume = if (summary.volumeKg >= 1000) {
                "${fmtNum(kotlin.math.round(summary.volumeKg / 100) / 10)} ${stringResource(Res.string.wk_unit_t)}"
            } else {
                "${summary.volumeKg.roundToInt()} ${stringResource(Res.string.wk_ph_kg)}"
            }
            add(volume to stringResource(Res.string.wk_summary_volume))
        }
    }
    Box(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("✓", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                stats.forEach { (value, label) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CountUp(value)
                        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            summary.prExercises.firstOrNull()?.let { first ->
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(stringResource(Res.string.wk_summary_pr_kicker), style = MaterialTheme.typography.labelMedium)
                        Text(first, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                        val others = summary.prExercises.drop(1)
                        if (others.isNotEmpty()) {
                            Text(
                                "${stringResource(Res.string.wk_summary_pr_more, others.size)}: ${others.joinToString(", ")}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            if (summary.leveledUp) {
                Text(stringResource(Res.string.wk_summary_level_up, summary.level), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            }
            if (summary.newBadges.isNotEmpty()) {
                Text(stringResource(Res.string.wk_summary_badges, summary.newBadges.joinToString(", ")), color = MaterialTheme.colorScheme.primary)
            }
            FeelBlock(vm, s)
            if (onAskCoach != null) {
                OutlinedButton(onClick = onAskCoach, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.wk_summary_ask_coach_btn)) }
            }
            if (asScreen) {
                Button(onClick = { vm.doneWithSummary() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.wk_summary_done_btn)) }
            }
        }
        if (celebrate) Confetti()
    }
}

@Composable
private fun FeelBlock(vm: LoggerViewModel, s: LoggerUi) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(Res.string.wk_feel_question), fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(
                "easy" to Res.string.wk_feel_easy,
                "ok" to Res.string.wk_feel_ok,
                "hard" to Res.string.wk_feel_hard,
            ).forEach { (value, label) ->
                val chosen = s.feel == value
                val locked = s.feelState == FeelState.BUSY || s.feelState == FeelState.DONE
                OutlinedButton(onClick = { vm.sendFeel(value) }, enabled = !locked) {
                    Text(stringResource(label), fontWeight = if (chosen) FontWeight.Bold else null)
                }
            }
        }
        if (s.feelState == FeelState.FAILED) {
            Text(stringResource(Res.string.wk_generic_error), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
    }
}

/** A number that counts up from zero; anything that is not a whole number is shown as it is. */
@Composable
private fun CountUp(value: String) {
    val target = value.toIntOrNull()
    if (target == null) {
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        return
    }
    val progress = remember(value) { Animatable(0f) }
    LaunchedEffect(value) { progress.animateTo(target.toFloat(), tween(durationMillis = 700)) }
    Text(progress.value.roundToInt().toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
}

private val CONFETTI_COLORS = listOf(Color(0xFFA8FF46), Color(0xFFFFD166), Color(0xFF06D6A0), Color(0xFF4CC9F0), Color(0xFFF72585))

/** A short burst of confetti for a record, a level-up or a badge. */
@Composable
private fun Confetti() {
    val progress = remember { Animatable(0f) }
    val pieces = remember {
        val random = Random(7)
        List(28) { random.nextFloat() - 0.5f to random.nextFloat() }
    }
    LaunchedEffect(Unit) { progress.animateTo(1f, tween(durationMillis = 1700)) }
    val p = progress.value
    if (p >= 1f) return
    Canvas(Modifier.fillMaxSize()) {
        pieces.forEachIndexed { i, (spread, drop) ->
            val x = size.width / 2 + spread * size.width * 0.8f * p
            val y = size.height * 0.15f + (0.25f + drop * 0.5f) * size.height * p
            drawRect(
                color = CONFETTI_COLORS[i % CONFETTI_COLORS.size].copy(alpha = 1f - p),
                topLeft = Offset(x, y),
                size = Size(8f, 14f),
            )
        }
    }
}
