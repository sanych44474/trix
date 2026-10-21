package app.hacklimits.shared.integrations

import app.hacklimits.shared.resources.integ_health_synced_sensor
import app.hacklimits.shared.resources.integ_health_sources
import app.hacklimits.shared.resources.integ_health_no_sources
import app.hacklimits.shared.resources.integ_health_open
import app.hacklimits.shared.resources.integ_sensor_title
import app.hacklimits.shared.resources.integ_sensor_hint
import app.hacklimits.shared.resources.integ_sensor_on
import app.hacklimits.shared.resources.integ_sensor_allow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.ui.errorText
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun IntegrationsScreen(onBack: () -> Unit, onRequestHealthPermission: () -> Unit, onRequestActivityPermission: () -> Unit = {}) {
    val vm: IntegrationsViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current

    // Refresh on every resume: OAuth finishes in the browser and the permission dialog is a separate activity.
    LifecycleResumeEffect(Unit) {
        vm.refresh()
        onPauseOrDispose {}
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) }
        }
        Text(stringResource(Res.string.integ_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)

        Section(stringResource(Res.string.integ_health_title)) {
            Text(stringResource(Res.string.integ_health_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            when {
                !s.healthAvailable -> Text(stringResource(Res.string.integ_health_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant)
                !s.healthGranted -> Button(onClick = { vm.reconnectHealth(); onRequestHealthPermission() }, enabled = !s.healthBusy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(Res.string.integ_health_connect))
                }
                else -> {
                    Text(stringResource(Res.string.integ_health_granted))
                    OutlinedButton(onClick = vm::disconnectHealth, enabled = !s.healthBusy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_health_disconnect))
                    }
                }
            }
            if (s.healthGranted || s.sensorGranted) {
                Button(onClick = vm::syncSteps, enabled = !s.healthBusy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(Res.string.integ_health_sync))
                }
            }
            s.healthSteps?.let {
                val line = if (s.stepsFromSensor) Res.string.integ_health_synced_sensor else Res.string.integ_health_synced
                Text(stringResource(line, it), modifier = Modifier.liveRegionPolite())
            }
            if (s.healthNoSteps) {
                Text(stringResource(Res.string.integ_health_no_steps), modifier = Modifier.liveRegionPolite())
                // Health Connect only holds what other apps write: say which do, or how to turn it on.
                val sources = s.healthSources.orEmpty()
                if (sources.isNotEmpty()) {
                    Text(stringResource(Res.string.integ_health_sources, sources.joinToString(", ")), color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else if (s.healthGranted) {
                    Text(stringResource(Res.string.integ_health_no_sources), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (s.healthAvailable) {
                    OutlinedButton(onClick = vm::openHealthSettings, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_health_open))
                    }
                }
            }
            s.healthError?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error, modifier = Modifier.liveRegionPolite()) }
        }

        if (s.sensorAvailable) {
            Section(stringResource(Res.string.integ_sensor_title)) {
                Text(stringResource(Res.string.integ_sensor_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (s.sensorGranted) {
                    Text(stringResource(Res.string.integ_sensor_on))
                    OutlinedButton(onClick = vm::openAppSettings, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_sensor_off))
                    }
                    Text(stringResource(Res.string.integ_sensor_off_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                } else {
                    OutlinedButton(onClick = onRequestActivityPermission, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_sensor_allow))
                    }
                }
            }
        }

        Section(stringResource(Res.string.integ_strava_title)) {
            Text(stringResource(Res.string.integ_strava_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            val strava = s.strava
            when {
                strava == null -> Unit
                !strava.available -> Text(stringResource(Res.string.integ_strava_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant)
                !strava.connected -> {
                    Text(stringResource(Res.string.integ_strava_disconnected))
                    Button(onClick = { vm.connectStrava { uri.openUri(it) } }, enabled = !s.stravaBusy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_strava_connect))
                    }
                    if (s.stravaOpened) Text(stringResource(Res.string.integ_strava_opened), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> {
                    Text(stringResource(Res.string.integ_strava_connected), fontWeight = FontWeight.SemiBold)
                    Text(
                        strava.lastSyncAt?.let { stringResource(Res.string.integ_strava_last_sync, formatSyncTime(it)) }
                            ?: stringResource(Res.string.integ_strava_never_synced),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (strava.lastError != null) Text(stringResource(Res.string.integ_strava_last_error), color = MaterialTheme.colorScheme.error)
                    Button(onClick = vm::syncStrava, enabled = !s.stravaBusy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.integ_strava_sync))
                    }
                    s.stravaImported?.let { Text(stringResource(Res.string.integ_strava_synced, it), modifier = Modifier.liveRegionPolite()) }
                    OutlinedButton(onClick = vm::disconnectStrava, enabled = !s.stravaBusy) {
                        Text(stringResource(Res.string.integ_strava_disconnect))
                    }
                }
            }
            s.stravaError?.let { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error, modifier = Modifier.liveRegionPolite()) }
        }
    }
}

/** The server sends ISO-8601 timestamps; minutes precision reads better on a phone. */
private fun formatSyncTime(iso: String): String = iso.replace('T', ' ').take(16)

private fun Modifier.liveRegionPolite(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
