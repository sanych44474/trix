package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.SyncOperation
import app.hacklimits.shared.workout.PendingSaves
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.offline_attention
import app.hacklimits.shared.resources.offline_cached
import app.hacklimits.shared.resources.offline_last_updated
import app.hacklimits.shared.resources.offline_pending
import app.hacklimits.shared.resources.offline_review
import app.hacklimits.shared.resources.offline_attention_title
import app.hacklimits.shared.resources.offline_attention_hint
import app.hacklimits.shared.resources.offline_operation
import app.hacklimits.shared.resources.offline_more
import app.hacklimits.shared.resources.offline_retry_all
import app.hacklimits.shared.resources.offline_discard_all
import app.hacklimits.shared.resources.offline_remove_confirm_title
import app.hacklimits.shared.resources.offline_remove_confirm_message
import app.hacklimits.shared.resources.offline_remove
import app.hacklimits.shared.resources.offline_cancel
import app.hacklimits.shared.resources.offline_kind_workout
import app.hacklimits.shared.resources.offline_kind_draft
import app.hacklimits.shared.resources.offline_kind_nutrition
import app.hacklimits.shared.resources.offline_kind_progress
import app.hacklimits.shared.resources.offline_error_network
import app.hacklimits.shared.resources.offline_error_rejected
import app.hacklimits.shared.resources.offline_error_generic
import kotlinx.coroutines.launch
import org.koin.compose.koinInject
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

@Composable
fun OfflineStatusNotice(
    offline: Boolean,
    pending: Int = 0,
    needsAttention: Int = 0,
    lastUpdatedAtMs: Long? = null,
) {
    if (!offline && pending == 0 && needsAttention == 0) return
    val pendingSaves = koinInject<PendingSaves>()
    val scope = rememberCoroutineScope()
    var showReview by remember { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var attentionItems by remember { mutableStateOf<List<SyncOperation>>(emptyList()) }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (offline) Text(stringResource(Res.string.offline_cached), color = MaterialTheme.colorScheme.onSecondaryContainer)
            if (lastUpdatedAtMs != null) {
                Text(
                    stringResource(Res.string.offline_last_updated, formatLastUpdated(lastUpdatedAtMs)),
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            if (pending > 0) Text(stringResource(Res.string.offline_pending, pending), color = MaterialTheme.colorScheme.onSecondaryContainer)
            if (needsAttention > 0) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(stringResource(Res.string.offline_attention, needsAttention), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = {
                        scope.launch {
                            attentionItems = pendingSaves.needsAttentionOperations()
                            showReview = true
                        }
                    }) { Text(stringResource(Res.string.offline_review)) }
                }
            }
        }
    }
    if (showReview) {
        AlertDialog(
            onDismissRequest = { showReview = false },
            title = { Text(stringResource(Res.string.offline_attention_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.offline_attention_hint))
                    attentionItems.take(8).forEach { operation ->
                        val kind = stringResource(operationKindText(operation.kind))
                        val error = stringResource(operationErrorText(operation.lastError))
                        Text(stringResource(Res.string.offline_operation, kind, error))
                    }
                    if (attentionItems.size > 8) Text(stringResource(Res.string.offline_more, attentionItems.size - 8))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        attentionItems.forEach { pendingSaves.retry(it) }
                        attentionItems = emptyList()
                        showReview = false
                    }
                }) { Text(stringResource(Res.string.offline_retry_all)) }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { confirmDiscard = true }) { Text(stringResource(Res.string.offline_discard_all)) }
                    TextButton(onClick = { showReview = false }) { Text(stringResource(Res.string.offline_cancel)) }
                }
            },
        )
    }
    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text(stringResource(Res.string.offline_remove_confirm_title)) },
            text = { Text(stringResource(Res.string.offline_remove_confirm_message)) },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        attentionItems.forEach { pendingSaves.discard(it) }
                        attentionItems = emptyList()
                        confirmDiscard = false
                        showReview = false
                    }
                }) { Text(stringResource(Res.string.offline_remove)) }
            },
            dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text(stringResource(Res.string.offline_cancel)) } },
        )
    }
}

private fun operationKindText(kind: String): StringResource = when (kind) {
    PendingSaves.WORKOUT_KIND -> Res.string.offline_kind_workout
    PendingSaves.DRAFT_KIND -> Res.string.offline_kind_draft
    PendingSaves.NUTRITION_KIND -> Res.string.offline_kind_nutrition
    PendingSaves.PROGRESS_KIND -> Res.string.offline_kind_progress
    else -> Res.string.offline_error_generic
}

private fun operationErrorText(error: String?): StringResource = when {
    error == "network" || error == "timeout" -> Res.string.offline_error_network
    error == "invalid_saved_workout" || error == "invalid_workout_draft" || error == "unsupported_sync_operation" -> Res.string.offline_error_rejected
    else -> Res.string.offline_error_generic
}

private fun formatLastUpdated(epochMs: Long): String {
    val local = Instant.fromEpochMilliseconds(epochMs).toLocalDateTime(TimeZone.currentSystemDefault())
    val date = local.date.toString()
    val time = "${local.hour.toString().padStart(2, '0')}:${local.minute.toString().padStart(2, '0')}"
    return "$date · $time"
}
