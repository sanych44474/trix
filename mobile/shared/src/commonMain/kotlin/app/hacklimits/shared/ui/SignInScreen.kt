package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.auth.SignInViewModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

@Composable
fun SignInScreen(vm: SignInViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        Text(stringResource(Res.string.app_name), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(stringResource(Res.string.signin_title), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text(stringResource(Res.string.signin_subtitle), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))

        if (s.providers?.googleClientId != null) {
            Button(onClick = vm::signInWithGoogle, enabled = !s.busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(stringResource(Res.string.signin_google))
            }
        }
        val telegram = s.telegram
        if (s.providers?.telegramAvailable == true && telegram == null) {
            OutlinedButton(onClick = vm::startTelegram, enabled = !s.busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(stringResource(Res.string.signin_telegram))
            }
        }
        if (telegram != null) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(Res.string.tg_code))
                    Text(telegram.matchCode, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    Button(onClick = { uri.openUri(telegram.telegramUrl) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(Res.string.tg_open)) }
                    Text(stringResource(Res.string.tg_waiting), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = vm::cancelTelegram) { Text(stringResource(Res.string.tg_cancel)) }
                }
            }
        }

        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text(stringResource(Res.string.signin_or_email), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (s.emailChallengeId == null) {
            OutlinedTextField(
                value = s.email, onValueChange = vm::onEmail, singleLine = true, modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(Res.string.signin_email)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
            )
            Button(onClick = vm::sendCode, enabled = !s.busy && s.email.contains('@'), modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(stringResource(Res.string.signin_send_code))
            }
        } else {
            Text(stringResource(Res.string.signin_code_sent, s.email))
            OutlinedTextField(
                value = s.code, onValueChange = vm::onCode, singleLine = true, modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(Res.string.signin_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            )
            Button(onClick = vm::verifyCode, enabled = !s.busy && s.code.length == 6, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(stringResource(Res.string.signin_verify))
            }
            TextButton(onClick = vm::changeEmail) { Text(stringResource(Res.string.signin_change_email)) }
        }
        s.error?.let { code ->
            Text(
                stringResource(errorText(code)), color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** Server and client error codes to text; anything unknown is a generic message. */
internal fun errorText(code: String): StringResource = when (code) {
    "network" -> Res.string.err_network
    "invalid_email" -> Res.string.err_invalid_email
    "invalid_code" -> Res.string.err_invalid_code
    "rate_limited" -> Res.string.err_rate_limited
    "telegram_expired", "invalid_challenge" -> Res.string.err_telegram_expired
    "google_no_account" -> Res.string.err_google_no_account
    "auth_unavailable", "google_unavailable", "telegram_unavailable" -> Res.string.err_unavailable
    else -> Res.string.err_generic
}
