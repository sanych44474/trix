package app.hacklimits.shared.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.round

/**
 * Squads, challenges, the leaderboard and the buddy in one screen, one tab each. [onOpenCoach]
 * opens the AI coach, or the trainer chat for a client with a trainer.
 */
@Composable
fun SocialScreen(onBack: () -> Unit, onOpenCoach: () -> Unit = {}) {
    val vm: SocialViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
            Text(stringResource(Res.string.social_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        OutlinedButton(
            onClick = onOpenCoach,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        ) { Text(stringResource(if (s.routed) Res.string.so_trainer_btn else Res.string.so_coach_btn)) }
        TabRow(selectedTabIndex = tab) {
            listOf(Res.string.social_tab_squads, Res.string.social_tab_challenges, Res.string.social_tab_leaderboard, Res.string.so_tab_buddy).forEachIndexed { i, label ->
                Tab(selected = tab == i, onClick = { tab = i }, text = { Text(stringResource(label)) })
            }
        }
        // Confirmations and failures are announced as they appear, not only when focused.
        s.notice?.let {
            Text(
                stringResource(noticeText(it)), Modifier.padding(horizontal = 16.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.primary,
            )
        }
        s.error?.let {
            Text(
                stringResource(socialErrorText(it)), Modifier.padding(horizontal = 16.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.error,
            )
        }
        when (tab) {
            0 -> SquadsTab(s, vm)
            1 -> ChallengesTab(s, vm)
            2 -> BoardsTab(s, vm)
            else -> BuddyTab(s, vm)
        }
    }
}

@Composable
private fun SquadsTab(s: SocialViewModel.State, vm: SocialViewModel) {
    val squads = s.squads
    if (squads == null) { SectionPlaceholder(s, vm); return }
    var title by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var leavingId by remember { mutableStateOf<Long?>(null) }
    val uri = LocalUriHandler.current
    // Clear an input only once its action succeeded, so a rejected entry stays for correction.
    LaunchedEffect(s.notice) {
        when (s.notice) {
            SocialViewModel.Notice.SQUAD_CREATED -> title = ""
            SocialViewModel.Notice.SQUAD_JOINED, SocialViewModel.Notice.SQUAD_ALREADY -> code = ""
            else -> Unit
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.social_squads_create_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        title, { title = it.take(40) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(Res.string.social_squad_name)) },
                    )
                    Button(onClick = { vm.createSquad(title) }, enabled = !s.busy && title.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.social_create))
                    }
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.social_squads_join_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        code, { code = it.take(200) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(Res.string.social_code_hint)) },
                    )
                    Button(
                        onClick = { vm.joinSquad(code) },
                        enabled = !s.busy && inviteCodeFrom(code).isNotEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(Res.string.social_join)) }
                }
            }
        }
        if (squads.isEmpty()) item { Text(stringResource(Res.string.social_squads_empty), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(squads, key = { it.id }) { squad ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(squad.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(Res.string.social_squad_summary, squad.memberCount, squad.total, squad.silent),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    squad.entries.forEach { e ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(e.medal.ifEmpty { "·" }, Modifier.padding(end = 8.dp))
                            Text(
                                if (e.me) "${e.name} ${stringResource(Res.string.social_you)}" else e.name,
                                Modifier.weight(1f),
                                fontWeight = if (e.me) FontWeight.Bold else FontWeight.Normal,
                            )
                            Text(stringResource(Res.string.social_entry_workouts, e.workouts))
                        }
                    }
                    // Only app-made squads have an invite link; group-chat squads are joined in Telegram.
                    squad.inviteLink?.let { link ->
                        TextButton(onClick = { uri.openUri(link) }) { Text(stringResource(Res.string.social_squad_invite)) }
                    }
                    if (leavingId == squad.id) {
                        Text(stringResource(Res.string.social_leave_confirm))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Button(onClick = { leavingId = null; vm.leaveSquad(squad.id) }, enabled = !s.busy) {
                                Text(stringResource(Res.string.social_leave_yes))
                            }
                            TextButton(onClick = { leavingId = null }) { Text(stringResource(Res.string.social_cancel)) }
                        }
                    } else {
                        TextButton(onClick = { leavingId = squad.id }, enabled = !s.busy) {
                            Text(stringResource(Res.string.social_leave), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChallengesTab(s: SocialViewModel.State, vm: SocialViewModel) {
    val c = s.challenges
    if (c == null) { SectionPlaceholder(s, vm); return }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(Res.string.social_challenges_won, c.won), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item { Text(stringResource(Res.string.social_challenges_active), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
        if (c.active.isEmpty()) item { Text(stringResource(Res.string.social_challenges_none_active), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(c.active, key = { it.code }) { ch ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${ch.emoji} ${ch.title}".trim(), fontWeight = FontWeight.SemiBold)
                    LinearProgressIndicator(progress = { ch.pct.coerceIn(0, 100) / 100f }, modifier = Modifier.fillMaxWidth())
                    Text(
                        if (ch.done) stringResource(Res.string.social_challenge_done)
                        else stringResource(Res.string.social_challenge_progress, ch.current, ch.target, ch.daysLeft),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        item { Text(stringResource(Res.string.social_challenges_available), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
        items(c.available, key = { it.code }) { ch ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${ch.emoji} ${ch.title}".trim(), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(Res.string.social_challenge_goal, ch.target), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Button(onClick = { vm.joinChallenge(ch.code) }, enabled = !s.busy) { Text(stringResource(Res.string.social_join)) }
                }
            }
        }
    }
}

@Composable
private fun BoardsTab(s: SocialViewModel.State, vm: SocialViewModel) {
    val b = s.boards
    if (b == null) { SectionPlaceholder(s, vm); return }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!b.optedIn) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(Res.string.social_board_optin_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(Res.string.social_board_optin_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = { vm.setCompete(true) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(Res.string.social_board_join))
                        }
                    }
                }
            }
        } else {
            item {
                TextButton(onClick = { vm.setCompete(false) }, enabled = !s.busy) { Text(stringResource(Res.string.social_board_leave)) }
            }
            boardSections(b).forEach { (title, board) -> item(key = title) { BoardCard(title, board) } }
        }
    }
}

@Composable
private fun BoardCard(title: StringResource, board: Boards.Board?) {
    if (board == null) return
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            // Rank 0 means the viewer is not on this board yet, which is not the same as last place.
            Text(
                if (board.rank > 0) stringResource(Res.string.social_board_your_rank, board.rank, board.total)
                else stringResource(Res.string.social_board_no_rank),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (board.top.isEmpty()) Text(stringResource(Res.string.social_board_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            board.top.forEach { row ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${row.pos}.", Modifier.padding(end = 8.dp))
                    Text(
                        if (row.me) "${row.name} ${stringResource(Res.string.social_you)}" else row.name,
                        Modifier.weight(1f),
                        fontWeight = if (row.me) FontWeight.Bold else FontWeight.Normal,
                    )
                    Text(row.detail.ifBlank { formatValue(row.value) })
                }
            }
        }
    }
}

@Composable
private fun BuddyTab(s: SocialViewModel.State, vm: SocialViewModel) {
    val response = s.buddy
    if (response == null) { SectionPlaceholder(s, vm); return }
    val buddy = response.buddy
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                if (buddy == null) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(Res.string.so_buddy_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(stringResource(Res.string.so_no_buddy_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(Res.string.so_no_buddy_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            Column {
                                Text(stringResource(Res.string.so_buddy_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(buddy.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            }
                            Text(stringResource(Res.string.so_level, buddy.level))
                        }
                        Text(stringResource(Res.string.so_buddy_stats, buddy.myWeekWorkouts, buddy.weekWorkouts, buddy.name, buddy.streak))
                        LinearProgressIndicator(
                            progress = { if (buddy.needed > 0) (buddy.intoLevel.toFloat() / buddy.needed).coerceIn(0f, 1f) else 1f },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

/** Loading spinner while the first load runs, otherwise a retry for a section that failed. */
@Composable
private fun SectionPlaceholder(s: SocialViewModel.State, vm: SocialViewModel) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (s.loading) CircularProgressIndicator()
        else Button(onClick = vm::load) { Text(stringResource(Res.string.retry)) }
    }
}

private fun boardSections(b: Boards): List<Pair<StringResource, Boards.Board?>> = listOf(
    Res.string.social_board_consistency to b.consistency,
    Res.string.social_board_improved to b.improved,
    Res.string.social_board_relative to b.relative,
    Res.string.social_board_total to b.total,
    Res.string.social_board_streak to b.streak,
    Res.string.social_board_recent_prs to b.recentPrs,
)

/** Whole numbers stay whole; a fractional score keeps one decimal. */
private fun formatValue(v: Double): String =
    if (v % 1.0 == 0.0) v.toLong().toString() else (round(v * 10) / 10).toString()

private fun noticeText(n: SocialViewModel.Notice): StringResource = when (n) {
    SocialViewModel.Notice.SQUAD_CREATED -> Res.string.social_notice_squad_created
    SocialViewModel.Notice.SQUAD_JOINED -> Res.string.social_notice_squad_joined
    SocialViewModel.Notice.SQUAD_ALREADY -> Res.string.social_notice_squad_already
    SocialViewModel.Notice.SQUAD_LEFT -> Res.string.social_notice_squad_left
    SocialViewModel.Notice.JOIN_NOT_FOUND -> Res.string.social_notice_join_not_found
    SocialViewModel.Notice.JOIN_FULL -> Res.string.social_notice_join_full
    SocialViewModel.Notice.TOO_MANY_SQUADS -> Res.string.social_notice_too_many_squads
    SocialViewModel.Notice.CHALLENGE_JOINED -> Res.string.social_notice_challenge_joined
    SocialViewModel.Notice.COMPETE_ON -> Res.string.social_notice_compete_on
    SocialViewModel.Notice.COMPETE_OFF -> Res.string.social_notice_compete_off
}

/** Social-specific codes first; the rest share the sign-in wording. */
private fun socialErrorText(code: String): StringResource =
    if (code == "not_found") Res.string.social_err_not_found else errorText(code)
