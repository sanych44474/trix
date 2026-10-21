package app.hacklimits.shared.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.upd_ready
import app.hacklimits.shared.resources.upd_required_body
import app.hacklimits.shared.resources.upd_required_title
import app.hacklimits.shared.resources.upd_restart
import app.hacklimits.shared.resources.upd_update
import org.jetbrains.compose.resources.stringResource

/** Shown instead of the whole app while this build is below the server's minimum. */
@Composable
fun UpdateRequiredScreen(onUpdate: () -> Unit) {
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(stringResource(Res.string.upd_required_title), style = MaterialTheme.typography.headlineMedium)
        Text(
            stringResource(Res.string.upd_required_body),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
        )
        Button(onClick = onUpdate, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(stringResource(Res.string.upd_update)) }
    }
}

/** A background update finished downloading: one tap restarts into it. */
@Composable
fun UpdateReadyBar(onRestart: () -> Unit, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.upd_ready), modifier = Modifier.weight(1f))
            TextButton(onClick = onRestart) { Text(stringResource(Res.string.upd_restart)) }
        }
    }
}
