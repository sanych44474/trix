package app.hacklimits.shared.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import kotlin.math.roundToInt

/** Meal photo estimate (confirm before logging) and a free-text or dictated food description. */
@Composable
fun MealPhotoScreen(onBack: () -> Unit, onLogged: () -> Unit) {
    val vm: MealPhotoViewModel = koinViewModel()
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(s.done) { if (s.done) onLogged() }
    val photoCd = stringResource(Res.string.media_photo_choose_cd)
    val micCd = stringResource(Res.string.media_voice_cd)

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { TextButton(onClick = onBack) { Text(stringResource(Res.string.back)) } }
        item { Text(stringResource(Res.string.media_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        s.error?.let { code ->
            item {
                Text(
                    stringResource(faultText(code)), color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }

        item {
            Panel {
                Text(stringResource(Res.string.media_photo_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = s.caption,
                    onValueChange = vm::onCaption,
                    label = { Text(stringResource(Res.string.md_meal_caption_ph)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = vm::choosePhoto, enabled = !s.busy, modifier = Modifier.fillMaxWidth()
                        .semantics { contentDescription = photoCd },
                ) { Text(stringResource(Res.string.media_photo_choose)) }
                if (s.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }

        if (s.estimated) {
            item {
                Panel {
                    Text(stringResource(Res.string.media_items_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (s.draft.isEmpty()) Text(stringResource(Res.string.md_meal_unreadable), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    s.draft.forEachIndexed { index, d ->
                        val preview = d.toLogged()
                        Text(d.estimate.desc, fontWeight = FontWeight.SemiBold)
                        OutlinedTextField(
                            value = d.gramsText,
                            onValueChange = { vm.onGrams(index, it) },
                            label = { Text(stringResource(Res.string.media_grams)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            isError = !isValidGrams(d.gramsText),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            stringResource(
                                Res.string.media_kcal_line,
                                preview.kcal.roundToInt(), preview.protein.roundToInt(), preview.fats.roundToInt(), preview.carbs.roundToInt(),
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { vm.removeItem(index) }, enabled = !s.busy) { Text(stringResource(Res.string.md_delete)) }
                    }
                    if (s.draft.isNotEmpty()) {
                        Button(
                            onClick = vm::logItems,
                            enabled = !s.busy && s.draft.all { isValidGrams(it.gramsText) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(Res.string.media_log_meal)) }
                    }
                }
            }
        }

        if (s.estimated) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = vm::choosePhoto, enabled = !s.busy, modifier = Modifier.weight(1f)) { Text(stringResource(Res.string.md_meal_another)) }
                    TextButton(onClick = vm::reset, enabled = !s.busy) { Text(stringResource(Res.string.md_close)) }
                }
            }
        }

        item {
            Panel {
                Text(stringResource(Res.string.media_text_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = s.text, onValueChange = vm::onText,
                        label = { Text(stringResource(Res.string.media_text_label)) },
                        modifier = Modifier.weight(1f),
                    )
                    if (vm.micAvailable) {
                        OutlinedButton(
                            onClick = vm::dictate,
                            enabled = !s.busy && !s.listening,
                            modifier = Modifier.semantics { contentDescription = micCd },
                        ) {
                            Text(stringResource(if (s.listening) Res.string.media_voice_listening else Res.string.media_voice_button))
                        }
                    }
                }
                if (vm.recordAvailable) {
                    OutlinedButton(onClick = vm::toggleRecording, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(if (s.recording) Res.string.md_voice_stop else Res.string.md_voice_record))
                    }
                }
                Button(onClick = vm::logText, enabled = !s.busy && s.text.trim().length >= 2, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(Res.string.media_text_log))
                }
            }
        }
    }
}

/** Server and local codes to text. A 429 is the AI's own daily or per-minute limit. */
private fun faultText(code: String): StringResource = when (code) {
    "network" -> Res.string.err_network
    "rate_limited" -> Res.string.media_err_rate_limited
    "dependency_unavailable" -> Res.string.media_err_ai_unavailable
    "validation_error" -> Res.string.media_err_bad_input
    CODE_PHOTO_LIMIT -> Res.string.md_meal_limit
    FAULT_NO_MIC -> Res.string.md_voice_no_mic
    FAULT_UNCLEAR -> Res.string.md_voice_unclear
    FAULT_UNREADABLE -> Res.string.media_text_unreadable
    FAULT_GRAMS -> Res.string.media_err_grams
    FAULT_SPEECH -> Res.string.media_err_speech
    FAULT_SPEECH_EMPTY -> Res.string.media_voice_nothing
    else -> Res.string.err_generic
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}
