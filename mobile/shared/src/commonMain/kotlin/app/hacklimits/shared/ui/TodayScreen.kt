package app.hacklimits.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.today.TodayViewModel
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun TodayScreen(vm: TodayViewModel, onStartWorkout: () -> Unit, onOpenPlan: () -> Unit, onStartQuestionnaire: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    // Refresh every time Today comes back into view (after a workout, the plan editor, the questionnaire).
    LaunchedEffect(Unit) { vm.refresh() }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.today_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        }
        when (val s = state) {
            TodayViewModel.State.Loading -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is TodayViewModel.State.Error -> {
                Text(stringResource(errorText(s.code)), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::refresh) { Text(stringResource(Res.string.retry)) }
            }
            is TodayViewModel.State.Ready -> {
                TodayContent(s.dashboard)
                if (!s.dashboard.viewer.onboarded && !s.dashboard.viewer.planPending) {
                    Button(onClick = onStartQuestionnaire, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                        Text(stringResource(Res.string.today_start_questionnaire))
                    }
                }
                if (s.dashboard.viewer.onboarded && !s.dashboard.viewer.planPending) {
                    if (s.dashboard.trainingToday) {
                        Button(onClick = onStartWorkout, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                            Text(stringResource(Res.string.today_start_workout))
                        }
                    } else {
                        Text(stringResource(Res.string.workout_rest_day), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    OutlinedButton(onClick = onOpenPlan, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.today_open_plan))
                    }
                    QuickLogCard(koinViewModel())
                }
            }
        }
    }
}

@Composable
private fun TodayContent(d: Dashboard) {
    d.name?.let { Text(stringResource(Res.string.today_hello, it), style = MaterialTheme.typography.titleLarge) }
    when {
        d.viewer.planPending -> Notice(stringResource(Res.string.today_plan_pending))
        !d.viewer.onboarded -> Notice(stringResource(Res.string.today_not_onboarded))
    }
    val week = d.calendar.days.takeLast(7)
    if (week.isNotEmpty()) {
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(Res.string.today_week), fontWeight = FontWeight.SemiBold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    week.forEach { day ->
                        val color = when (day.status) {
                            "done" -> MaterialTheme.colorScheme.primary
                            "missed" -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.surfaceContainerHigh
                        }
                        Box(
                            Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(color)
                                .semantics { contentDescription = "${day.date}: ${day.status}" },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Notice(text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Text(text, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}
