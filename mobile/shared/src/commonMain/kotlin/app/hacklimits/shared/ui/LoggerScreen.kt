package app.hacklimits.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.rest_over_body
import app.hacklimits.shared.resources.rest_over_title
import app.hacklimits.shared.resources.workout_title
import app.hacklimits.shared.resources.wk_cancel_btn
import app.hacklimits.shared.resources.wk_close
import app.hacklimits.shared.resources.wk_exercise_more_aria
import app.hacklimits.shared.resources.wk_finish_confirm
import app.hacklimits.shared.resources.wk_finish_confirm_no_time
import app.hacklimits.shared.resources.wk_focus_close_aria
import app.hacklimits.shared.resources.wk_focus_counter
import app.hacklimits.shared.resources.wk_generic_error
import app.hacklimits.shared.resources.wk_ok
import app.hacklimits.shared.resources.wk_rest_day_detail
import app.hacklimits.shared.resources.wk_rest_day_title
import app.hacklimits.shared.resources.wk_retry
import app.hacklimits.shared.resources.wk_session_saved_for_date
import app.hacklimits.shared.resources.wk_swap_overwrite_plan
import app.hacklimits.shared.resources.wk_today_done_title
import app.hacklimits.shared.resources.wk_train_delete_typed_confirm
import app.hacklimits.shared.resources.wk_train_tab_history
import app.hacklimits.shared.resources.wk_train_tab_plan
import app.hacklimits.shared.resources.wk_train_tab_today
import app.hacklimits.shared.resources.wk_training_session_title
import app.hacklimits.shared.resources.wk_unauthorized_error
import app.hacklimits.shared.workout.LoggerTab
import app.hacklimits.shared.workout.LoggerUi
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.logic.fmtDuration
import app.hacklimits.shared.workout.logic.isExerciseFilled
import app.hacklimits.shared.workout.logic.isSetFilled
import app.hacklimits.shared.workout.logic.sessionElapsedSec
import app.hacklimits.shared.workout.ui.FocusView
import app.hacklimits.shared.workout.ui.HistoryView
import app.hacklimits.shared.workout.ui.LoggerNotes
import app.hacklimits.shared.workout.ui.OverviewView
import app.hacklimits.shared.workout.ui.RestBar
import app.hacklimits.shared.workout.ui.SaveDock
import app.hacklimits.shared.workout.ui.SummaryView
import kotlin.math.max
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import org.jetbrains.compose.resources.stringResource

/**
 * The guided workout logger (Mini App parity). Tabs: Today (overview and focus mode), Plan (the
 * caller's plan editor, [planContent]) and History. The session lives in [vm]. [onClose] leaves the
 * logger; [onAskCoach] is the summary's "ask the coach" button, when the app has a coach to open.
 */
@OptIn(ExperimentalTime::class)
@Composable
fun LoggerScreen(
    vm: LoggerViewModel,
    onClose: () -> Unit,
    onAskCoach: (() -> Unit)? = null,
    planContent: (@Composable () -> Unit)? = null,
) {
    val s by vm.ui.collectAsStateWithLifecycle()
    val restTitle = stringResource(Res.string.rest_over_title)
    val restBody = stringResource(Res.string.rest_over_body)
    LaunchedEffect(restTitle, restBody) { vm.setRestTexts(restTitle, restBody) }
    LifecycleResumeEffect(Unit) {
        vm.onResume()
        onPauseOrDispose {}
    }
    val sessionTitle = s.title.ifBlank { stringResource(Res.string.wk_training_session_title) }

    Column(Modifier.fillMaxSize().imePadding()) {
        TopBar(vm, s, onClose, hasPlan = planContent != null)
        val exercises = s.exercises
        val filled = exercises.count(::isExerciseFilled)
        val summary = s.summary
        val summaryScreen = summary != null && s.focus
        val showDock = s.tab == LoggerTab.TODAY && s.error == null && !s.loading && exercises.isNotEmpty() &&
            !summaryScreen && (s.focus || filled > 0)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                s.loading -> Centered { CircularProgressIndicator() }
                s.error != null -> Centered {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            stringResource(if (s.error == "unauthorized") Res.string.wk_unauthorized_error else Res.string.wk_generic_error),
                            color = MaterialTheme.colorScheme.error,
                        )
                        Button(onClick = { vm.load() }) { Text(stringResource(Res.string.wk_retry)) }
                    }
                }
                s.tab == LoggerTab.HISTORY -> HistoryView(vm, s, s.date)
                s.tab == LoggerTab.PLAN -> planContent?.invoke()
                exercises.isEmpty() -> Centered {
                    Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(Res.string.wk_rest_day_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(stringResource(Res.string.wk_rest_day_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                summary != null && s.focus -> SummaryView(
                    vm, s, summary,
                    title = s.summaryDate?.let { stringResource(Res.string.wk_session_saved_for_date, it) }
                        ?: stringResource(Res.string.wk_today_done_title),
                    subtitle = sessionTitle,
                    onAskCoach = onAskCoach,
                    asScreen = true,
                )
                s.focus -> {
                    val currentIndex = exercises.firstOrNull { !complete(it) }?.index ?: exercises.last().index
                    val focusIndex = s.focusIndex ?: currentIndex
                    val at = max(0, exercises.indexOfFirst { it.index == focusIndex })
                    Column(Modifier.fillMaxSize()) {
                        FocusBar(vm, s, at)
                        LoggerNotes(vm, s)
                        FocusView(vm, s, at)
                    }
                }
                else -> OverviewView(vm, s, sessionTitle, onStart = { index -> vm.openFocus(index) })
            }
        }
        if (showDock) {
            SaveDock(vm, s, restBar = { if (s.rest.endAtMs != null) RestBar(vm, s.rest) })
        }
    }

    FinishDialog(vm, s)
    RemoveDialog(vm, s)
    PlanSwapDialog(vm, s)
}

private fun complete(ex: app.hacklimits.shared.workout.logic.LoggerExercise): Boolean =
    ex.done.count(::isSetFilled) >= max(1, ex.sets)

@Composable
private fun TopBar(vm: LoggerViewModel, s: LoggerUi, onClose: () -> Unit, hasPlan: Boolean) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text(stringResource(Res.string.wk_close)) }
            Text(stringResource(Res.string.workout_title), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        // Focus mode has no tab bar: one exercise on screen, the way the Mini App does it.
        if (!s.focus) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TabButton(stringResource(Res.string.wk_train_tab_today), s.tab == LoggerTab.TODAY) { vm.setTab(LoggerTab.TODAY) }
                if (hasPlan) TabButton(stringResource(Res.string.wk_train_tab_plan), s.tab == LoggerTab.PLAN) { vm.setTab(LoggerTab.PLAN) }
                TabButton(stringResource(Res.string.wk_train_tab_history), s.tab == LoggerTab.HISTORY) { vm.setTab(LoggerTab.HISTORY) }
            }
        }
    }
}

@Composable
private fun TabButton(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) Button(onClick = onClick) { Text(label) } else OutlinedButton(onClick = onClick) { Text(label) }
}

/** Focus mode's top bar: close, the position in the workout, the "more" menu, and one bar per exercise. */
@Composable
private fun FocusBar(vm: LoggerViewModel, s: LoggerUi, at: Int) {
    val exercises = s.exercises
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { vm.closeFocus() }) { Text(stringResource(Res.string.wk_focus_close_aria)) }
            Text(
                stringResource(Res.string.wk_focus_counter, at + 1, exercises.size),
                Modifier.weight(1f),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            TextButton(onClick = { vm.toggleMenu() }) { Text(stringResource(Res.string.wk_exercise_more_aria)) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            exercises.forEachIndexed { i, ex ->
                val done = ex.done.count(::isSetFilled)
                val color = when {
                    complete(ex) -> MaterialTheme.colorScheme.primary
                    i == at -> MaterialTheme.colorScheme.onSurface
                    done > 0 -> MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)
                    else -> MaterialTheme.colorScheme.outlineVariant
                }
                Box(
                    Modifier.weight(1f).height(6.dp)
                        .background(color, RectangleShape)
                        .clickable { vm.goToExercise(ex.index) },
                )
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

@OptIn(ExperimentalTime::class)
@Composable
private fun FinishDialog(vm: LoggerViewModel, s: LoggerUi) {
    if (!s.finishConfirm) return
    val sets = s.exercises.sumOf { ex -> ex.done.count(::isSetFilled) }
    val elapsed = sessionElapsedSec(s.clock, Clock.System.now().toEpochMilliseconds())
    AlertDialog(
        onDismissRequest = { vm.dismissFinish() },
        text = {
            Text(
                if (elapsed > 0) stringResource(Res.string.wk_finish_confirm, sets, fmtDuration(elapsed))
                else stringResource(Res.string.wk_finish_confirm_no_time, sets),
            )
        },
        confirmButton = { TextButton(onClick = { vm.confirmFinish() }) { Text(stringResource(Res.string.wk_ok)) } },
        dismissButton = { TextButton(onClick = { vm.dismissFinish() }) { Text(stringResource(Res.string.wk_cancel_btn)) } },
    )
}

@Composable
private fun RemoveDialog(vm: LoggerViewModel, s: LoggerUi) {
    val index = s.removeConfirm ?: return
    AlertDialog(
        onDismissRequest = { vm.dismissRemove() },
        text = { Text(stringResource(Res.string.wk_train_delete_typed_confirm)) },
        confirmButton = { TextButton(onClick = { vm.confirmRemove(index) }) { Text(stringResource(Res.string.wk_ok)) } },
        dismissButton = { TextButton(onClick = { vm.dismissRemove() }) { Text(stringResource(Res.string.wk_cancel_btn)) } },
    )
}

@Composable
private fun PlanSwapDialog(vm: LoggerViewModel, s: LoggerUi) {
    val confirm = s.planSwapConfirm ?: return
    AlertDialog(
        onDismissRequest = { vm.dismissPlanSwap() },
        text = { Text(stringResource(Res.string.wk_swap_overwrite_plan, confirm.planName, confirm.choice.name)) },
        confirmButton = { TextButton(onClick = { vm.confirmPlanSwap() }) { Text(stringResource(Res.string.wk_ok)) } },
        dismissButton = { TextButton(onClick = { vm.dismissPlanSwap() }) { Text(stringResource(Res.string.wk_cancel_btn)) } },
    )
}
