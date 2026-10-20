package app.hacklimits.shared

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.ui.LoggerScreen
import app.hacklimits.shared.ui.OnboardingScreen
import app.hacklimits.shared.ui.PlanScreen
import app.hacklimits.shared.ui.SignInScreen
import app.hacklimits.shared.ui.TodayScreen
import app.hacklimits.shared.ui.theme.HackLimitsTheme
import app.hacklimits.shared.workout.PendingSaves
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

@Serializable object TodayRoute
@Serializable object LoggerRoute
@Serializable object PlanRoute
@Serializable object OnboardingRoute

/** Root: signed out -> sign-in; signed in -> the app. A 401 from the server signs out. */
@Composable
fun App(onSignedIn: () -> Unit = {}, beforeSignOut: suspend () -> Unit = {}) {
    HackLimitsTheme {
        Surface(Modifier.fillMaxSize()) {
            val sessions = koinInject<SessionStore>()
            val api = koinInject<ApiClient>()
            val auth = koinInject<AuthApi>()
            val pending = koinInject<PendingSaves>()
            val scope = rememberCoroutineScope()
            val signedIn by sessions.signedIn.collectAsStateWithLifecycle()
            LaunchedEffect(api) { api.sessionExpired.collect { sessions.clear() } }
            LaunchedEffect(signedIn) {
                if (signedIn) {
                    onSignedIn()
                    runCatching { pending.flush() } // workouts saved offline last time
                }
            }
            if (!signedIn) {
                SignInScreen(koinViewModel())
                return@Surface
            }
            val nav = rememberNavController()
            NavHost(nav, startDestination = TodayRoute) {
                composable<TodayRoute> {
                    TodayScreen(
                        koinViewModel(),
                        onStartWorkout = { nav.navigate(LoggerRoute) },
                        onOpenPlan = { nav.navigate(PlanRoute) },
                        onStartQuestionnaire = { nav.navigate(OnboardingRoute) },
                        onSignOut = { scope.launch { runCatching { beforeSignOut() }; auth.logout() } },
                    )
                }
                composable<OnboardingRoute> {
                    OnboardingScreen(koinViewModel(), onDone = { nav.popBackStack() }, onClose = { nav.popBackStack() })
                }
                composable<PlanRoute> {
                    PlanScreen(koinViewModel(), onClose = { nav.popBackStack() })
                }
                composable<LoggerRoute> {
                    LoggerScreen(koinViewModel(), onClose = { nav.popBackStack() })
                }
            }
        }
    }
}
