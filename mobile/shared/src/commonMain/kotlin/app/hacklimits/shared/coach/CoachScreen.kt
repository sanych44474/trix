package app.hacklimits.shared.coach

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.chat.ChatContent
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.theme.LocalReducedMotion
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import app.hacklimits.shared.telemetry.Telemetry
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

/**
 * The AI coach: a chat with plan-aware answers, buttons that apply a suggested change or send
 * feedback to the team, and the session's history. A client with a trainer gets the trainer chat
 * here instead, with their open questions on top.
 */
@Composable
fun CoachScreen(onBack: () -> Unit) {
    val vm: CoachViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val telemetry = koinInject<Telemetry>()
    LaunchedEffect(Unit) { telemetry.track("app_coach_open_today") }
    val listState = rememberLazyListState()
    val itemCount = s.lines.size + if (s.sending) 1 else 0
    val reducedMotion = LocalReducedMotion.current
    LaunchedEffect(itemCount, reducedMotion) {
        if (itemCount > 0) {
            if (reducedMotion) listState.scrollToItem(itemCount - 1)
            else listState.animateScrollToItem(itemCount - 1)
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(horizontal = 16.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
        Text(
            stringResource(if (s.routed) Res.string.co_trainer_eyebrow else Res.string.co_ai_eyebrow),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(if (s.routed) Res.string.co_trainer_title else Res.string.co_ai_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))

        val loadError = s.loadError
        when {
            s.loading -> Box(Modifier.weight(1f).fillMaxWidth()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
            loadError != null -> Box(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        stringResource(coachErrorText(loadError)),
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    TextButton(onClick = vm::load) { Text(stringResource(Res.string.coach_retry)) }
                }
            }
            s.routed -> RoutedBody(s)
            else -> SoloBody(s, vm, listState)
        }
    }
}

/** A client's own trainer answers: the open questions, then the chat with the trainer. */
@Composable
private fun ColumnScope.RoutedBody(s: CoachState) {
    val name = s.trainerName.ifEmpty { stringResource(Res.string.co_trainer_fallback) }
    Text(
        stringResource(Res.string.co_trainer_detail, name),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (s.openQuestions.isNotEmpty()) {
        Spacer(Modifier.height(8.dp))
        Text(stringResource(Res.string.co_questions_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        s.openQuestions.forEach { q ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(q.text, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(Res.string.co_awaiting_reply),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    ChatContent(peerId = null, modifier = Modifier.weight(1f).fillMaxWidth())
}

@Composable
private fun ColumnScope.SoloBody(s: CoachState, vm: CoachViewModel, listState: LazyListState) {
    Box(Modifier.weight(1f).fillMaxWidth()) {
        when {
            s.lines.isEmpty() && !s.sending -> Text(
                stringResource(Res.string.co_intro),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
            )
            else -> LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().semantics { liveRegion = LiveRegionMode.Polite },
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(s.lines, key = { it.id }) { line -> CoachBubble(line, s, vm) }
                if (s.sending) item(key = "typing") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text(stringResource(Res.string.coach_typing), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    s.sendError?.let { code -> ErrorRow(code, retry = vm::retry, enabled = !s.sending) }
    s.actionError?.let { code -> Text(stringResource(coachErrorText(code)), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }

    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
        OutlinedTextField(
            value = s.input,
            onValueChange = vm::onInputChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text(stringResource(Res.string.coach_input_hint)) },
            maxLines = 4,
            keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { vm.send() }),
        )
        Spacer(Modifier.width(8.dp))
        Button(
            onClick = vm::send,
            enabled = s.input.isNotBlank() && !s.sending,
            modifier = Modifier.height(56.dp),
        ) { Text(stringResource(Res.string.coach_send)) }
    }
    if (s.lines.isNotEmpty()) {
        TextButton(onClick = vm::clear, enabled = !s.sending) { Text(stringResource(Res.string.co_clear)) }
    }
}

@Composable
private fun ErrorRow(code: String, retry: () -> Unit, enabled: Boolean) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(coachErrorText(code)),
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
        )
        TextButton(onClick = retry, enabled = enabled) { Text(stringResource(Res.string.coach_retry)) }
    }
}

@Composable
private fun CoachBubble(line: CoachLine, s: CoachState, vm: CoachViewModel) {
    if (line.role == CoachRole.Routed) {
        Text(
            stringResource(Res.string.coach_routed),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    val mine = line.role == CoachRole.User
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        if (line.role == CoachRole.Coach) {
            Text(stringResource(Res.string.coach_label_coach), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
            contentColor = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Text(line.text, modifier = Modifier.padding(12.dp))
        }
        if (line.actions.isNotEmpty()) {
            Column(Modifier.widthIn(max = 320.dp).padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                line.actions.forEachIndexed { i, action ->
                    val done = i in line.done
                    val busy = s.applying == "${line.id}:$i"
                    OutlinedButton(
                        onClick = { vm.apply(line.id, i) },
                        enabled = !done && s.applying == null,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            when {
                                done -> "✓ " + stringResource(if (action.kind == "feedback") Res.string.co_feedback_sent else Res.string.co_action_done)
                                busy -> "…"
                                else -> action.label
                            },
                        )
                    }
                }
            }
        }
    }
}

/** Maps the server's error code (or "network" for a failed transport) to the coach's message. */
internal fun coachErrorText(code: String): StringResource = when (code) {
    "network" -> Res.string.coach_err_network
    "rate_limited" -> Res.string.coach_err_rate_limited
    "validation_error" -> Res.string.coach_err_invalid
    "not_found" -> Res.string.coach_err_not_found
    else -> Res.string.coach_err_generic
}
