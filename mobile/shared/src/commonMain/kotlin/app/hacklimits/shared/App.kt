package app.hacklimits.shared

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.tab_more
import app.hacklimits.shared.resources.tab_today
import app.hacklimits.shared.ui.LoggerScreen
import app.hacklimits.shared.ui.MoreScreen
import app.hacklimits.shared.ui.OnboardingScreen
import app.hacklimits.shared.ui.PlanScreen
import app.hacklimits.shared.ui.SignInScreen
import app.hacklimits.shared.ui.TodayScreen
import app.hacklimits.shared.ui.theme.HackLimitsIcons
import app.hacklimits.shared.ui.theme.HackLimitsTheme
import app.hacklimits.shared.workout.PendingSaves
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

@Serializable object TodayRoute
@Serializable object MoreRoute
@Serializable object LoggerRoute
@Serializable object PlanRoute
@Serializable object OnboardingRoute

/** A bottom-bar tab: its route, label and icon. Full-screen flows (workout, plan, questionnaire)
 * open above the tabs without the bar. */
private data class Tab(val route: Any, val label: StringResource, val icon: ImageVector)

private val TABS = listOf(
    Tab(TodayRoute, Res.string.tab_today, HackLimitsIcons.Today),
    Tab(MoreRoute, Res.string.tab_more, HackLimitsIcons.More),
)

/** Root: signed out -> sign-in; signed in -> the app. A 401 from the server signs out. */
@Composable
fun App(onSignedIn: () -> Unit = {}, beforeSignOut: suspend () -> Unit = {}) {
    HackLimitsTheme {
        Surface(Modifier.fillMaxSize()) {
            val sessions = koinInject<SessionStore>()
            val api = koinInject<ApiClient>()
            val auth = koinInject<AuthApi>()
            val pending = koinInject<PendingSaves>()
            val platform = koinInject<AppPlatform>()
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
            val entry by nav.currentBackStackEntryAsState()
            val onTab = TABS.any { tab -> entry?.destination?.hasRoute(tab.route::class) == true }
            Scaffold(
                bottomBar = {
                    if (onTab) NavigationBar {
                        TABS.forEach { tab ->
                            NavigationBarItem(
                                selected = entry?.destination?.hasRoute(tab.route::class) == true,
                                onClick = {
                                    nav.navigate(tab.route) {
                                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(tab.icon, contentDescription = null) },
                                label = { Text(stringResource(tab.label)) },
                            )
                        }
                    }
                },
            ) { padding ->
                // Scaffold supplies the system-bar insets; consuming them stops a screen's imePadding counting them twice.
                NavHost(nav, startDestination = TodayRoute, modifier = Modifier.padding(padding).consumeWindowInsets(padding)) {
                    composable<TodayRoute> {
                        TodayScreen(
                            koinViewModel(),
                            onStartWorkout = { nav.navigate(LoggerRoute) },
                            onOpenPlan = { nav.navigate(PlanRoute) },
                            onStartQuestionnaire = { nav.navigate(OnboardingRoute) },
                        )
                    }
                    composable<MoreRoute> {
                        MoreScreen(
                            koinViewModel(),
                            privacyUrl = platform.privacyPolicyUrl,
                            onSignOut = { scope.launch { runCatching { beforeSignOut() }; auth.logout() } },
                            beforeSignOut = beforeSignOut,
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
}
