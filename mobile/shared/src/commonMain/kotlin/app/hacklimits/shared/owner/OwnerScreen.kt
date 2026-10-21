package app.hacklimits.shared.owner

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.min
import kotlin.time.Clock

private const val ROSTER_PAGE = 30
private const val RELEASE_BATCH = 25

/**
 * The owner console: release notes, announcements, a promo picture, the people roster with
 * moderation, feedback triage and the reports. Only reachable for the owner (see [OwnerApi.isOwner]).
 */
@Composable
fun OwnerScreen(onBack: () -> Unit) {
    val vm: OwnerViewModel = koinViewModel()
    val feedback: FeedbackTriageViewModel = koinViewModel()
    val broadcast: BroadcastViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val fb by feedback.state.collectAsStateWithLifecycle()
    val bc by broadcast.state.collectAsStateWithLifecycle()
    val users = s.users
    val generic = stringResource(Res.string.ow_generic_error)

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TextButton(onClick = onBack) { Text(stringResource(Res.string.ow_back)) } }
        when {
            users == null && s.loadFailed -> item {
                OwnerPanel {
                    Text(generic, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = vm::retry) { Text(stringResource(Res.string.ow_retry)) }
                }
            }
            users == null -> item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            else -> {
                item {
                    Column {
                        Text(stringResource(Res.string.ow_ops_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(stringResource(Res.string.ow_pulse_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                        Text(stringResource(Res.string.ow_n_users, users.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (s.actionError) {
                    item {
                        OwnerPanel {
                            Text(generic, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                            TextButton(onClick = vm::dismissActionError) { Text(stringResource(Res.string.ow_close)) }
                        }
                    }
                }
                item {
                    ReleasePanel(
                        release = bc.release,
                        onAsk = broadcast::askReleaseConfirm,
                        onSend = broadcast::sendRelease,
                    )
                }
                item {
                    AnnouncePanel(
                        announce = bc.announce,
                        onText = broadcast::setAnnounceText,
                        onAsk = broadcast::askAnnounceConfirm,
                        onSend = broadcast::sendAnnounce,
                        onNew = broadcast::newAnnouncement,
                    )
                }
                item {
                    PromoPanel(image = bc.image, onPrompt = broadcast::setPrompt, onMake = broadcast::makeImage)
                }
                item {
                    TabGrid(selected = s.section, busy = s.reportBusy, onSelect = vm::select)
                }
                when (s.section) {
                    SECTION_ROSTER -> item {
                        RosterPanel(
                            users = users,
                            busy = s.rosterBusy,
                            nudged = s.nudged,
                            onAction = vm::moderate,
                        )
                    }
                    SECTION_FEEDBACK -> item {
                        FeedbackPanel(
                            state = fb,
                            onFilter = feedback::setFilter,
                            onCategory = feedback::setCategory,
                            onNotify = feedback::setNotify,
                            onStatus = { row, status -> feedback.update(row, status = status) },
                            onCategoryOf = { row, category -> feedback.update(row, category = category) },
                        )
                    }
                    else -> item {
                        ReportPanel(
                            section = s.section,
                            html = s.reports[s.section],
                            inactiveSent = s.inactiveSent,
                            onAskInactive = vm::askInactive,
                        )
                    }
                }
            }
        }
    }
}

private val TABS = listOf(
    Tab(SECTION_OVERVIEW, "📊", Res.string.ow_tab_overview),
    Tab(SECTION_ROSTER, "👥", Res.string.ow_tab_roster),
    Tab(SECTION_FEEDBACK, "✍️", Res.string.ow_tab_feedback),
    Tab("retention", "🧲", Res.string.ow_tab_retention),
    Tab("ai", "🤖", Res.string.ow_tab_ai),
    Tab("trainers", "🧑‍🏫", Res.string.ow_tab_trainers),
    Tab("onboarding", "🚪", Res.string.ow_tab_onboarding),
    Tab("errors", "⚠️", Res.string.ow_tab_errors),
    Tab("events", "📈", Res.string.ow_tab_events),
)

private class Tab(val id: String, val icon: String, val label: StringResource)

private class ReportCopy(val id: String, val tab: StringResource, val eyebrow: StringResource, val title: StringResource)

private val REPORTS = listOf(
    ReportCopy(SECTION_OVERVIEW, Res.string.ow_tab_overview, Res.string.ow_overview_eyebrow, Res.string.ow_live_report_title),
    ReportCopy("retention", Res.string.ow_tab_retention, Res.string.ow_retention_eyebrow, Res.string.ow_retention_title),
    ReportCopy("ai", Res.string.ow_tab_ai, Res.string.ow_ai_eyebrow, Res.string.ow_ai_title),
    ReportCopy("trainers", Res.string.ow_tab_trainers, Res.string.ow_trainers_eyebrow, Res.string.ow_trainers_title),
    ReportCopy("onboarding", Res.string.ow_tab_onboarding, Res.string.ow_funnel_eyebrow, Res.string.ow_funnel_title),
    ReportCopy("errors", Res.string.ow_tab_errors, Res.string.ow_errors_eyebrow, Res.string.ow_errors_title),
    ReportCopy("events", Res.string.ow_tab_events, Res.string.ow_events_eyebrow, Res.string.ow_events_title),
)

@Composable
private fun OwnerPanel(
    eyebrow: StringResource? = null,
    title: StringResource? = null,
    trailing: @Composable () -> Unit = {},
    content: @Composable () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (eyebrow != null || title != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        eyebrow?.let { Text(stringResource(it), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        title?.let { Text(stringResource(it), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
                    }
                    trailing()
                }
            }
            content()
        }
    }
}

@Composable
private fun ReleasePanel(
    release: BroadcastViewModel.Release,
    onAsk: (Boolean) -> Unit,
    onSend: () -> Unit,
) {
    val info = release.info ?: return
    val pending = info.pending
    OwnerPanel(eyebrow = Res.string.ow_release_eyebrow, title = Res.string.ow_release_title) {
        Text(
            if (pending > 0) stringResource(Res.string.ow_release_pending, info.version, pending)
            else stringResource(Res.string.ow_release_none, info.version),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        release.result?.let { r ->
            Text(
                if (r.queued != null) stringResource(Res.string.ow_broadcast_queued, r.queued)
                else stringResource(Res.string.ow_release_result, r.sent, r.failed, r.remaining),
            )
        }
        if (release.failed) Text(stringResource(Res.string.ow_generic_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (pending > 0) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (release.confirm) {
                    Button(onClick = onSend, enabled = !release.busy) {
                        Text(
                            when {
                                release.busy -> "…"
                                info.queue -> stringResource(Res.string.ow_release_confirm_all, pending)
                                else -> stringResource(Res.string.ow_release_confirm, min(RELEASE_BATCH, pending))
                            },
                        )
                    }
                    TextButton(onClick = { onAsk(false) }, enabled = !release.busy) { Text(stringResource(Res.string.ow_close)) }
                } else {
                    OutlinedButton(onClick = { onAsk(true) }) {
                        Text(
                            if (info.queue) stringResource(Res.string.ow_release_send_all, pending)
                            else stringResource(Res.string.ow_release_send, min(RELEASE_BATCH, pending)),
                        )
                    }
                }
            }
        }
        Text(
            stringResource(if (info.queue) Res.string.ow_release_hint_queue else Res.string.ow_release_hint),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun AnnouncePanel(
    announce: BroadcastViewModel.Announce,
    onText: (String) -> Unit,
    onAsk: (Boolean) -> Unit,
    onSend: () -> Unit,
    onNew: () -> Unit,
) {
    val progress = announce.progress
    val finished = progress != null && progress.next == null
    val hasText = announce.text.trim().isNotEmpty()
    OwnerPanel(eyebrow = Res.string.ow_announce_eyebrow, title = Res.string.ow_announce_title) {
        OutlinedTextField(
            value = announce.text,
            onValueChange = onText,
            enabled = progress == null || finished,
            minLines = 4,
            placeholder = { Text(stringResource(Res.string.ow_announce_ph)) },
            modifier = Modifier.fillMaxWidth(),
        )
        progress?.let { p ->
            Text(
                if (p.queued != null) stringResource(Res.string.ow_broadcast_queued, p.queued)
                else stringResource(Res.string.ow_announce_progress, p.sent, p.failed, p.remaining),
            )
        }
        if (announce.failed) Text(stringResource(Res.string.ow_generic_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                finished -> OutlinedButton(onClick = onNew) { Text(stringResource(Res.string.ow_announce_new)) }
                announce.confirm -> {
                    Button(onClick = onSend, enabled = !announce.busy && hasText) {
                        Text(
                            when {
                                announce.busy -> "…"
                                progress != null -> stringResource(Res.string.ow_announce_continue)
                                announce.queue -> stringResource(Res.string.ow_announce_confirm_all)
                                else -> stringResource(Res.string.ow_announce_confirm)
                            },
                        )
                    }
                    TextButton(onClick = { onAsk(false) }, enabled = !announce.busy) { Text(stringResource(Res.string.ow_close)) }
                }
                else -> OutlinedButton(onClick = { onAsk(true) }, enabled = hasText) {
                    Text(stringResource(if (progress != null) Res.string.ow_announce_continue else Res.string.ow_announce_send))
                }
            }
        }
    }
}

@Composable
private fun PromoPanel(
    image: BroadcastViewModel.Image,
    onPrompt: (String) -> Unit,
    onMake: () -> Unit,
) {
    OwnerPanel(eyebrow = Res.string.ow_image_eyebrow, title = Res.string.ow_image_title) {
        OutlinedTextField(
            value = image.prompt,
            onValueChange = onPrompt,
            minLines = 3,
            placeholder = { Text(stringResource(Res.string.ow_image_ph)) },
            modifier = Modifier.fillMaxWidth(),
        )
        when (image.status) {
            BroadcastViewModel.ImageStatus.SENT -> Text(stringResource(Res.string.ow_image_sent), color = MaterialTheme.colorScheme.onSurfaceVariant)
            BroadcastViewModel.ImageStatus.BUDGET -> Text(stringResource(Res.string.ow_image_budget), color = MaterialTheme.colorScheme.onSurfaceVariant)
            BroadcastViewModel.ImageStatus.FAILED -> Text(stringResource(Res.string.ow_generic_error), color = MaterialTheme.colorScheme.onSurfaceVariant)
            null -> Unit
        }
        Button(onClick = onMake, enabled = !image.busy && image.prompt.trim().length >= 3) {
            Text(if (image.busy) "…" else stringResource(Res.string.ow_image_make))
        }
        Text(stringResource(Res.string.ow_image_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}

/** The section switcher: every tab visible at once in a grid, so none is hidden off-screen on a phone. */
@Composable
private fun TabGrid(selected: String, busy: Boolean, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TABS.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { tab ->
                    val on = selected == tab.id
                    FilterChip(
                        selected = on,
                        onClick = { onSelect(tab.id) },
                        enabled = !busy || on,
                        label = { Text("${tab.icon} ${stringResource(tab.label)}", maxLines = 1) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun RosterPanel(
    users: List<OwnerUser>,
    busy: String?,
    nudged: Set<Long>,
    onAction: (OwnerUser, String) -> Unit,
) {
    val now = remember { Clock.System.now() }
    var filter by remember { mutableStateOf(RosterFilter.ALL) }
    var open by remember { mutableStateOf<Long?>(null) }
    var confirmDelete by remember { mutableStateOf<Long?>(null) }
    var shown by remember { mutableStateOf(ROSTER_PAGE) }
    val list = rosterRows(users, filter, now)
    val counts = mapOf(
        RosterFilter.ALL to users.size,
        RosterFilter.ONBOARDING to users.count { it.status == "onboarding" },
        RosterFilter.ACTIVE to users.count { !isIdle(it, now) && it.status != "onboarding" },
        RosterFilter.IDLE to users.count { isIdle(it, now) },
    )
    val filterLabels = mapOf(
        RosterFilter.ALL to Res.string.ow_roster_f_all,
        RosterFilter.ONBOARDING to Res.string.ow_roster_f_onboarding,
        RosterFilter.ACTIVE to Res.string.ow_roster_f_active,
        RosterFilter.IDLE to Res.string.ow_roster_f_idle,
    )

    OwnerPanel(
        eyebrow = Res.string.ow_roster_eyebrow,
        title = Res.string.ow_recent_users_title,
        trailing = { Text("${users.size}", style = MaterialTheme.typography.labelLarge) },
    ) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RosterFilter.entries.forEach { f ->
                FilterChip(
                    selected = filter == f,
                    onClick = { filter = f; shown = ROSTER_PAGE },
                    label = { Text("${stringResource(filterLabels.getValue(f))} · ${counts.getValue(f)}") },
                )
            }
        }
        if (list.isEmpty()) Text(stringResource(Res.string.ow_roster_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
        list.take(shown).forEach { user ->
            val isOpen = open == user.id
            Column(Modifier.fillMaxWidth().clickable {
                open = if (isOpen) null else user.id
                confirmDelete = null
            }.padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(user.name, fontWeight = FontWeight.SemiBold)
                        Text(
                            buildStatus(user),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(seenText(seenLabel(user.lastSeen, now)), style = MaterialTheme.typography.bodySmall)
                        Text("${user.total}", style = MaterialTheme.typography.labelLarge)
                    }
                }
                if (isOpen) {
                    RosterActions(
                        user = user,
                        busy = busy,
                        nudged = nudged,
                        confirmDelete = confirmDelete == user.id,
                        onConfirmDelete = { confirmDelete = user.id },
                        onAction = { action ->
                            confirmDelete = null
                            onAction(user, action)
                        },
                    )
                }
            }
        }
        if (shown < list.size) {
            OutlinedButton(onClick = { shown += ROSTER_PAGE }) {
                Text(stringResource(Res.string.ow_library_more, list.size - shown))
            }
        }
    }
}

@Composable
private fun RosterActions(
    user: OwnerUser,
    busy: String?,
    nudged: Set<Long>,
    confirmDelete: Boolean,
    onConfirmDelete: () -> Unit,
    onAction: (String) -> Unit,
) {
    val blocked = user.status == "banned"
    val nickPart = if (user.nick.isNotEmpty()) "${user.nick} · " else ""
    val stats = "$nickPart🏋 ${user.w}  ✓ ${user.c}  🍽 ${user.n}  👣 ${user.s}"
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stats, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (user.status == "onboarding") {
                val isNudged = user.id in nudged
                val nudgeBusy = busy == "nudge:${user.id}"
                Button(onClick = { onAction("nudge") }, enabled = !nudgeBusy && !isNudged) {
                    Text(
                        when {
                            isNudged -> stringResource(Res.string.ow_roster_nudged)
                            nudgeBusy -> "…"
                            else -> stringResource(Res.string.ow_roster_nudge_btn)
                        },
                    )
                }
            }
            val moderationAction = if (blocked) "unblock" else "block"
            OutlinedButton(onClick = { onAction(moderationAction) }, enabled = busy != "$moderationAction:${user.id}") {
                Text(stringResource(if (blocked) Res.string.ow_unblock_btn else Res.string.ow_block_btn))
            }
            if (confirmDelete) {
                Button(
                    onClick = { onAction("delete") },
                    enabled = busy != "delete:${user.id}",
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(Res.string.ow_delete_confirm_btn)) }
            } else {
                TextButton(onClick = onConfirmDelete) { Text(stringResource(Res.string.ow_delete_btn), color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun buildStatus(user: OwnerUser): String {
    val base = stringResource(statusRes(user.status))
    val withOnb = if (user.onb.isNotEmpty()) "$base ${user.onb}" else base
    return if (user.trainer.isNotEmpty()) "$withOnb · ${user.trainer}" else withOnb
}

private fun statusRes(status: String): StringResource = when (status) {
    "banned" -> Res.string.ow_st_banned
    "blocked" -> Res.string.ow_st_blocked
    "onboarding" -> Res.string.ow_st_onboarding
    "active" -> Res.string.ow_st_active
    "draft" -> Res.string.ow_st_draft
    else -> Res.string.ow_st_none
}

@Composable
private fun seenText(label: SeenLabel): String = when (label.kind) {
    SeenKind.NEVER -> stringResource(Res.string.ow_seen_never)
    SeenKind.TODAY -> stringResource(Res.string.ow_seen_today)
    SeenKind.YESTERDAY -> stringResource(Res.string.ow_seen_yesterday)
    SeenKind.DAYS -> stringResource(Res.string.ow_seen_days, label.days)
    SeenKind.DATE -> stringResource(Res.string.ow_seen_date, label.date)
}

@Composable
private fun FeedbackPanel(
    state: FeedbackTriageViewModel.State,
    onFilter: (String) -> Unit,
    onCategory: (String) -> Unit,
    onNotify: (Boolean) -> Unit,
    onStatus: (FeedbackRow, String) -> Unit,
    onCategoryOf: (FeedbackRow, String) -> Unit,
) {
    val page = state.page
    OwnerPanel(eyebrow = Res.string.ow_fbt_eyebrow, title = Res.string.ow_fbt_title) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("new", "done", "wontfix", "all").forEach { status ->
                val count = page?.counts?.let {
                    when (status) {
                        "new" -> it.new
                        "done" -> it.done
                        "wontfix" -> it.wontfix
                        else -> null
                    }
                }
                FilterChip(
                    selected = state.filter == status,
                    onClick = { onFilter(status) },
                    label = { Text(stringResource(statusLabel(status)) + (count?.let { " · $it" } ?: "")) },
                )
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.category == "all", onClick = { onCategory("all") }, label = { Text(stringResource(Res.string.ow_fbt_cat_all)) })
            FEEDBACK_CATEGORIES.forEach { c ->
                FilterChip(selected = state.category == c, onClick = { onCategory(c) }, label = { Text(stringResource(categoryLabel(c))) })
            }
        }
        if (state.filter == "new") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = state.notify, onCheckedChange = onNotify)
                Text(stringResource(Res.string.ow_fbt_notify))
            }
        }
        if (state.failed) Text(stringResource(Res.string.ow_generic_error), color = MaterialTheme.colorScheme.error)
        if (page == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        } else {
            val rows = page.rows.filter { state.category == "all" || it.category == state.category }
            if (rows.isEmpty()) Text(stringResource(Res.string.ow_fbt_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            rows.forEach { row ->
                val busy = state.busyId == row.id
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "${row.name?.takeIf { it.isNotEmpty() } ?: row.username?.let { "@$it" } ?: "id ${row.userId}"} · ${row.date}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(row.text)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FEEDBACK_CATEGORIES.forEach { c ->
                            FilterChip(
                                selected = row.category == c,
                                onClick = { if (row.category != c && !busy) onCategoryOf(row, c) },
                                label = { Text(stringResource(categoryLabel(c))) },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (row.status != "done") {
                            Button(onClick = { onStatus(row, "done") }, enabled = !busy) {
                                Text(if (busy) "…" else stringResource(Res.string.ow_fbt_mark_done))
                            }
                        }
                        if (row.status == "new") {
                            OutlinedButton(onClick = { onStatus(row, "wontfix") }, enabled = !busy) { Text(stringResource(Res.string.ow_fbt_mark_wontfix)) }
                        }
                        if (row.status != "new") {
                            OutlinedButton(onClick = { onStatus(row, "new") }, enabled = !busy) { Text(stringResource(Res.string.ow_fbt_reopen)) }
                        }
                    }
                }
            }
        }
    }
}

private val FEEDBACK_CATEGORIES = listOf("bug", "idea", "complaint", "praise", "rating", "other")

private fun statusLabel(status: String): StringResource = when (status) {
    "new" -> Res.string.ow_fbt_status_new
    "done" -> Res.string.ow_fbt_status_done
    "wontfix" -> Res.string.ow_fbt_status_wontfix
    else -> Res.string.ow_fbt_status_all
}

private fun categoryLabel(category: String): StringResource = when (category) {
    "bug" -> Res.string.ow_fbt_cat_bug
    "idea" -> Res.string.ow_fbt_cat_idea
    "complaint" -> Res.string.ow_fbt_cat_complaint
    "praise" -> Res.string.ow_fbt_cat_praise
    "rating" -> Res.string.ow_fbt_cat_rating
    else -> Res.string.ow_fbt_cat_other
}

@Composable
private fun ReportPanel(
    section: String,
    html: String?,
    inactiveSent: Int?,
    onAskInactive: () -> Unit,
) {
    val copy = REPORTS.firstOrNull { it.id == section } ?: REPORTS.first()
    OwnerPanel(
        eyebrow = copy.eyebrow,
        title = copy.title,
        trailing = {
            if (copy.id == SECTION_OVERVIEW) {
                OutlinedButton(onClick = onAskInactive) { Text(stringResource(Res.string.ow_ask_inactive_btn)) }
            }
        },
    ) {
        if (html == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        } else {
            Text(
                plainReport(html),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            )
        }
        if (copy.id == SECTION_OVERVIEW && inactiveSent != null) {
            Text(stringResource(Res.string.ow_sent_to_n_users, inactiveSent), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
