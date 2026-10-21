package app.hacklimits.shared.inbox

import app.hacklimits.shared.resources.ib_feedback_reply
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlin.time.Clock
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/**
 * The notification feed. Each row leads to the screen that owns it through [onOpen]; the host
 * maps an [InboxTarget] to its route.
 */
@Composable
fun InboxScreen(onBack: () -> Unit, onOpen: (InboxTarget) -> Unit) {
    val vm: InboxViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val uk = Locale.current.language == "uk"
    val now = remember { Clock.System.now() }
    val zone = remember { TimeZone.currentSystemDefault() }

    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(stringResource(Res.string.ib_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            TextButton(onClick = onBack) { Text(stringResource(Res.string.ib_close)) }
        }

        val items = s.items
        when {
            s.failed -> Text(
                stringResource(Res.string.ib_error),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            items == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            items.isEmpty() -> Text(stringResource(Res.string.ib_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.id }) { item -> InboxRow(item, uk, now, zone, onOpen) }
            }
        }
    }
}

@Composable
private fun InboxRow(
    item: InboxItem,
    uk: Boolean,
    now: Instant,
    zone: TimeZone,
    onOpen: (InboxTarget) -> Unit,
) {
    val line = inboxLine(item, uk) ?: return
    val target = inboxTarget(item.kind) ?: return
    val defaultSquad = stringResource(Res.string.ib_squads_default)
    val args = line.args.map { if (it is DefaultSquadName) defaultSquad else it }.toTypedArray()
    val text = stringResource(line.copy.resource(), *args)
    val whenText = inboxWhen(item.createdAt, now, zone)?.let { w ->
        when (w) {
            is InboxWhen.Clock -> w.hhmm
            InboxWhen.Yesterday -> stringResource(Res.string.ib_seen_yesterday)
            is InboxWhen.Day -> w.ddmm
        }
    }

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (item.read) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.primaryContainer)
            .clickable { onOpen(target) }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(inboxIcon(item.kind), contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(text, Modifier.weight(1f))
        whenText?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
    }
}

private fun InboxCopy.resource(): StringResource = when (this) {
    InboxCopy.PLAN_ASSIGNED -> Res.string.ib_plan_assigned
    InboxCopy.PLAN_CHANGED -> Res.string.ib_plan_changed
    InboxCopy.MESSAGE -> Res.string.ib_message
    InboxCopy.BADGE -> Res.string.ib_badge
    InboxCopy.PROGRESSION -> Res.string.ib_progression
    InboxCopy.FEEDBACK_DONE -> Res.string.ib_feedback_done
    InboxCopy.FEEDBACK_REPLY -> Res.string.ib_feedback_reply
    InboxCopy.SQUAD_PR -> Res.string.ib_squad_pr
    InboxCopy.SQUAD_WEEK -> Res.string.ib_squad_week
    InboxCopy.SQUAD_WEEK_PAST -> Res.string.ib_squad_week_past
}
