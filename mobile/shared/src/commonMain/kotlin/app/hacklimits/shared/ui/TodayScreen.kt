package app.hacklimits.shared.ui

import app.hacklimits.shared.daily.ChecklistTarget
import app.hacklimits.shared.daily.EveningChecklistCard
import app.hacklimits.shared.daily.checklistTargetOf
import app.hacklimits.shared.trainingextras.ComebackViewModel
import app.hacklimits.shared.resources.tx_comeback_title
import app.hacklimits.shared.resources.tx_comeback_next
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.data.KeyValueStore
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.today.BadgeCelebration
import app.hacklimits.shared.today.DayMark
import app.hacklimits.shared.today.QuickLogViewModel
import app.hacklimits.shared.today.RecoveryDetailsCard
import app.hacklimits.shared.today.RecoveryPill
import app.hacklimits.shared.today.RecoverySwapCard
import app.hacklimits.shared.today.SessionProgress
import app.hacklimits.shared.today.TodayInput
import app.hacklimits.shared.today.TodayPlan
import app.hacklimits.shared.today.TodayPrefs
import app.hacklimits.shared.today.TodayState
import app.hacklimits.shared.today.TodayViewModel
import app.hacklimits.shared.today.WaterStepsCard
import app.hacklimits.shared.today.WeekCardView
import app.hacklimits.shared.today.WeekStrip
import app.hacklimits.shared.today.WeekSummaryCard
import app.hacklimits.shared.today.WorkoutBlock
import app.hacklimits.shared.today.Notice
import app.hacklimits.shared.today.formatDecimal
import app.hacklimits.shared.today.lastWeekSummary
import app.hacklimits.shared.today.todayPlan
import app.hacklimits.shared.today.unseenBadges
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import app.hacklimits.shared.plan.FineTuneApi
import app.hacklimits.shared.account.WhatsNewApi
import app.hacklimits.shared.account.WhatsNewCard
import app.hacklimits.shared.account.WhatsNewNote
import app.hacklimits.shared.plan.FineTuneCard
import org.koin.compose.viewmodel.koinViewModel

/**
 * Today: the workout block (start / continue / logged / rest day), the week as seven days, the
 * recovery-swap nudge, and the "more" section (recovery, water and steps, week card, last week).
 * Port of the Mini App's Today.tsx, with logic/todayPlan.ts and Week.tsx.
 */
@Composable
fun TodayScreen(
    vm: TodayViewModel,
    onStartWorkout: () -> Unit,
    onOpenPlan: () -> Unit,
    onStartQuestionnaire: () -> Unit,
    onOpenTraining: () -> Unit = {},
    onAskCoach: () -> Unit = {},
    onOpenFood: () -> Unit = {},
    onOpenProgress: () -> Unit = {},
    onOpenComeback: () -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val store: KeyValueStore = koinInject()
    val prefs = remember(store) { TodayPrefs(store) }
    val quick: QuickLogViewModel = koinViewModel()
    // Refresh every time Today comes back into view (after a workout, the plan editor, the questionnaire).
    LaunchedEffect(Unit) { vm.refresh() }
    var session by remember { mutableStateOf<SessionProgress?>(null) }
    LaunchedEffect(state) { session = prefs.session() }

    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(stringResource(Res.string.td_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        when (val s = state) {
            TodayViewModel.State.Loading -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is TodayViewModel.State.Error -> {
                Text(stringResource(errorText(s.code)), color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::refresh) { Text(stringResource(Res.string.td_retry)) }
            }
            is TodayViewModel.State.Ready -> {
                val d = s.dashboard
                d.name?.let { Text(stringResource(Res.string.td_hello, it), style = MaterialTheme.typography.titleLarge) }
                when {
                    d.viewer.planPending -> Notice(stringResource(Res.string.td_plan_pending))
                    !d.viewer.onboarded -> Notice(stringResource(Res.string.td_not_onboarded))
                }
                if (!d.viewer.onboarded && !d.viewer.planPending) {
                    Button(onClick = onStartQuestionnaire, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                        Text(stringResource(Res.string.td_start_questionnaire))
                    }
                }
                if (d.viewer.onboarded && !d.viewer.planPending) {
                    TodayBody(d, session, vm, quick, prefs, onStartWorkout, onOpenTraining, onAskCoach, onOpenPlan, onOpenFood, onOpenProgress, onOpenComeback)
                }
            }
        }
    }
}

@Composable
private fun TodayBody(
    d: Dashboard,
    session: SessionProgress?,
    vm: TodayViewModel,
    quick: QuickLogViewModel,
    prefs: TodayPrefs,
    onStartWorkout: () -> Unit,
    onOpenTraining: () -> Unit,
    onAskCoach: () -> Unit,
    onOpenPlan: () -> Unit,
    onOpenFood: () -> Unit,
    onOpenProgress: () -> Unit,
    onOpenComeback: () -> Unit,
) {
    val plan: TodayPlan = remember(d, session) {
        todayPlan(
            TodayInput(
                today = d.today,
                planExercises = d.logForm?.exercises ?: emptyList(),
                plannedWeekdays = d.calendar.split.map { it.weekday },
                days = d.calendar.days,
                logs = d.calendar.logs,
                session = session,
            ),
        )
    }
    val todayWeekday = plan.week.firstOrNull { it.today }?.weekday
    val group = d.calendar.split.firstOrNull { it.weekday == todayWeekday }?.group
    val scope = rememberCoroutineScope()

    var more by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { more = prefs.moreOpen() }
    val toggleMore: () -> Unit = {
        val next = !more
        more = next
        scope.launch { prefs.setMoreOpen(next) }
    }

    // Last week's card: Monday to Wednesday only, until dismissed for that week.
    val summary = remember(d) { lastWeekSummary(d) }
    var summarySeen by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(summary.start) { summarySeen = prefs.weekSummarySeen() ?: "" }
    val todayIsEarlyWeek = LocalDate.parse(d.today).dayOfWeek.ordinal <= 2
    val showSummary = summarySeen != null && summarySeen != summary.start && todayIsEarlyWeek &&
        (summary.workouts > 0 || summary.foodDays > 0 || summary.weightDelta != null)

    // Badges earned since the app last showed them: celebrated once, then remembered.
    var celebrate by remember { mutableStateOf<List<Dashboard.Badge>>(emptyList()) }
    val badgeCodes = d.badges.map { it.code }
    LaunchedEffect(badgeCodes) {
        val fresh = unseenBadges(badgeCodes, prefs.seenBadges())
        prefs.saveSeenBadges(fresh.seen)
        celebrate = d.badges.filter { it.code in fresh.show }
    }

    WorkoutBlock(plan, d.lang, group, d.logForm?.minutes ?: 0) {
        if (plan.state == TodayState.Start || plan.state == TodayState.Continue) onStartWorkout() else onOpenTraining()
    }

    d.recoverySwap?.takeIf { plan.state == TodayState.Start }?.let { swap ->
        RecoverySwapCard(d.lang, swap, onSwap = vm::swapDays, onDone = vm::refresh)
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.td_week_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(stringResource(Res.string.td_week_count, plan.weekDone, plan.weekPlanned), style = MaterialTheme.typography.labelMedium)
        }
        WeekStrip(plan.week)
    }

    ComebackPrompt(onOpenComeback)
    EveningChecklistCard(
        onOpen = { key ->
            when (checklistTargetOf(key)) {
                ChecklistTarget.Fuel -> onOpenFood()
                ChecklistTarget.Progress -> onOpenProgress()
                ChecklistTarget.Today -> Unit // water and steps are logged on this screen
            }
        },
        refreshKey = d,
    )

    FineTuneSlot(d.viewer.profileGaps, onSaved = vm::refresh)
    WhatsNewSlot(d.whatsnew)

    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column {
            ListRow(label = stringResource(Res.string.td_metric_recovery), expanded = more, onClick = toggleMore, trailing = { RecoveryPill(d.recovery) })
            ListRow(
                label = stringResource(if (d.viewer.role == "client") Res.string.td_coach_trainer else Res.string.td_coach),
                expanded = null,
                onClick = onAskCoach,
            )
            d.todayStats?.let { stats ->
                ListRow(
                    label = stringResource(Res.string.td_water_steps),
                    expanded = more,
                    onClick = toggleMore,
                    trailing = {
                        Text(
                            stringResource(
                                Res.string.td_water_steps_value,
                                formatDecimal(stats.waterMl / 1000),
                                stringResource(Res.string.td_unit_l),
                                formatDecimal(stats.steps.toDouble()),
                            ),
                            style = MaterialTheme.typography.labelLarge,
                        )
                    },
                )
            }
        }
    }

    if (more) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            RecoveryDetailsCard(d.recovery)
            d.todayStats?.let { stats -> WaterStepsCard(stats, quick, onSaved = vm::refresh) }
            d.week?.let { week -> WeekCardView(d.lang, week) }
            if (showSummary) {
                WeekSummaryCard(d.lang, summary) {
                    summarySeen = summary.start
                    scope.launch { prefs.setWeekSummarySeen(summary.start) }
                }
            }
        }
    }

    OutlinedButton(onClick = onOpenPlan, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(Res.string.td_open_plan))
    }

    if (celebrate.isNotEmpty()) {
        BadgeCelebration(celebrate) { celebrate = emptyList() }
    }
}

/** One tappable row of the Today list: a label, an optional trailing value, and the open/closed mark. */
@Composable
private fun ListRow(label: String, expanded: Boolean?, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(label, Modifier.weight(1f), fontWeight = FontWeight.Medium)
        trailing()
        if (expanded != null) Text(if (expanded) "▴" else "▾", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Shown only while the profile still has gaps (d.viewer.profileGaps). */
@Composable
private fun FineTuneSlot(gaps: List<String>, onSaved: () -> Unit) {
    if (gaps.isEmpty()) return
    val api = koinInject<FineTuneApi>()
    FineTuneCard(gaps = gaps, onSave = api::save, onSaved = onSaved)
}

/** The server includes d.whatsnew only while that release is due for this person. */
@Composable
private fun WhatsNewSlot(whatsnew: Dashboard.WhatsNew?) {
    if (whatsnew == null) return
    val api = koinInject<WhatsNewApi>()
    WhatsNewCard(note = WhatsNewNote(whatsnew.version, text = whatsnew.text), onGotIt = api::markSeen)
}

/** After a vacation the server holds a short "welcome back" interview; offer it until it's answered. */
@Composable
private fun ComebackPrompt(onOpen: () -> Unit) {
    val vm: ComebackViewModel = koinViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    if (!state.pending) return
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.tx_comeback_title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Button(onClick = onOpen) { Text(stringResource(Res.string.tx_comeback_next)) }
        }
    }
}
