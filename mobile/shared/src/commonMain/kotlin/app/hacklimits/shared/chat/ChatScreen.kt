package app.hacklimits.shared.chat

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.theme.LocalReducedMotion
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/** The trainer <-> client chat as its own screen. [peerId] is the client for a trainer; null is the client's own trainer. */
@Composable
fun ChatScreen(peerId: Long? = null, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(horizontal = 16.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
        Text(stringResource(Res.string.ch_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        ChatContent(peerId = peerId, modifier = Modifier.weight(1f).fillMaxWidth())
    }
}

/**
 * The thread, its input and the AI draft button, without a screen frame: the AI coach embeds it
 * for a client's own trainer. Fills [modifier]; give it a weight inside a Column.
 */
@Composable
fun ChatContent(peerId: Long?, modifier: Modifier = Modifier) {
    val vm: ChatViewModel = koinViewModel(
        key = "chat:${peerId ?: 0L}",
        parameters = { parametersOf(peerId ?: 0L) },
    )
    val s by vm.state.collectAsStateWithLifecycle()
    val thread = s.thread
    val count = thread?.messages?.size ?: 0
    val listState = rememberLazyListState()
    val reducedMotion = LocalReducedMotion.current
    LaunchedEffect(count, reducedMotion) {
        if (count > 0) {
            if (reducedMotion) listState.scrollToItem(count - 1)
            else listState.animateScrollToItem(count - 1)
        }
    }

    Column(modifier) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                thread == null && s.missing -> Text(
                    stringResource(Res.string.ch_unavailable),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
                )
                thread == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                thread.messages.isEmpty() -> Text(
                    stringResource(if (thread.peer.isTrainer) Res.string.ch_empty_client else Res.string.ch_empty_trainer),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().semantics { liveRegion = LiveRegionMode.Polite },
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(thread.messages, key = { it.id }) { message -> ChatBubble(message) }
                }
            }
        }

        s.error?.let { code ->
            Text(
                stringResource(chatErrorText(code)),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = s.input,
                onValueChange = vm::onInputChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(Res.string.ch_input_hint)) },
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = vm::send,
                enabled = s.input.isNotBlank() && !s.sending,
                modifier = Modifier.height(56.dp),
            ) { Text(stringResource(Res.string.ch_send)) }
        }

        // The AI draft only exists for a trainer writing to a client; the server enforces the same rule.
        if (peerId != null && thread?.messages?.any { !it.fromMe } == true) {
            TextButton(onClick = vm::draft, enabled = !s.drafting && !s.sending) {
                Text(stringResource(Res.string.ch_ai_draft))
            }
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessage) {
    val mine = message.fromMe
    // Two ticks once the other side has opened the thread.
    val ticks = when {
        !mine -> ""
        message.read -> " ✓✓"
        else -> " ✓"
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
            contentColor = if (mine) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Text(message.text, modifier = Modifier.padding(12.dp))
        }
        Text(
            chatStamp(message.createdAt) + ticks,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

internal fun chatErrorText(code: String): StringResource = when (code) {
    "network" -> Res.string.ch_err_network
    else -> Res.string.ch_err_generic
}
