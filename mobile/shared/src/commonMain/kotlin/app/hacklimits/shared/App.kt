package app.hacklimits.shared

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.ui.SignInScreen
import app.hacklimits.shared.ui.TodayScreen
import app.hacklimits.shared.ui.theme.HackLimitsTheme
import kotlinx.coroutines.launch
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

/** Root: signed out -> sign-in; signed in -> the app. A 401 from the server signs out. */
@Composable
fun App(onSignedIn: () -> Unit = {}, beforeSignOut: suspend () -> Unit = {}) {
    HackLimitsTheme {
        Surface(Modifier.fillMaxSize()) {
            val sessions = koinInject<SessionStore>()
            val api = koinInject<ApiClient>()
            val auth = koinInject<AuthApi>()
            val scope = rememberCoroutineScope()
            val signedIn by sessions.signedIn.collectAsStateWithLifecycle()
            LaunchedEffect(api) { api.sessionExpired.collect { sessions.clear() } }
            LaunchedEffect(signedIn) { if (signedIn) onSignedIn() }
            if (signedIn) {
                TodayScreen(koinViewModel(), onSignOut = { scope.launch { runCatching { beforeSignOut() }; auth.logout() } })
            } else {
                SignInScreen(koinViewModel())
            }
        }
    }
}
