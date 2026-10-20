package app.hacklimits.shared.coach

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun CoachScreen(onBack: () -> Unit) {
    val vm: CoachViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val itemCount = s.lines.size + if (s.sending) 1 else 0
    LaunchedEffect(itemCount) { if (itemCount > 0) listState.animateScrollToItem(itemCount - 1) }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(horizontal = 16.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
        Text(stringResource(Res.string.coach_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))

        val loadError = s.loadError
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                s.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                loadError != null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        stringResource(coachErrorText(loadError)),
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    TextButton(onClick = vm::load) { Text(stringResource(Res.string.coach_retry)) }
                }
                s.lines.isEmpty() && !s.sending -> Text(
                    stringResource(Res.string.coach_empty),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().semantics { liveRegion = LiveRegionMode.Polite },
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(s.lines, key = { it.id }) { line -> CoachBubble(line) }
                    if (s.sending) item(key = "typing") {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text(stringResource(Res.string.coach_typing), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }

        s.sendError?.let { code ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(coachErrorText(code)),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                )
                TextButton(onClick = vm::retry, enabled = !s.sending) { Text(stringResource(Res.string.coach_retry)) }
            }
        }

        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = s.input,
                onValueChange = vm::onInputChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(Res.string.coach_input_hint)) },
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { vm.send() }),
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = vm::send,
                enabled = s.input.isNotBlank() && !s.sending,
                modifier = Modifier.height(56.dp),
            ) { Text(stringResource(Res.string.coach_send)) }
        }
    }
}

@Composable
private fun CoachBubble(line: CoachLine) {
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
        when (line.role) {
            CoachRole.Coach -> Text(stringResource(Res.string.coach_label_coach), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            CoachRole.Trainer -> Text(stringResource(Res.string.coach_label_trainer), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Unit
        }
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
            contentColor = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Text(line.text, modifier = Modifier.padding(12.dp))
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
