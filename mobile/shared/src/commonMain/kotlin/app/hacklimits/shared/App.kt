package app.hacklimits.shared

import app.hacklimits.shared.platform.OpenView
import app.hacklimits.shared.trainingextras.CardioScreen
import app.hacklimits.shared.trainingextras.ComebackScreen
import app.hacklimits.shared.trainingextras.StandardsCard
import app.hacklimits.shared.trainertools.TrainerReportScreen
import app.hacklimits.shared.trainertools.ProgramSharingScreen
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Column
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
import androidx.navigation.toRoute
import app.hacklimits.shared.coach.CoachScreen
import app.hacklimits.shared.chat.ChatScreen
import app.hacklimits.shared.inbox.InboxScreen
import app.hacklimits.shared.inbox.InboxTarget
import app.hacklimits.shared.plan.ExerciseLibraryScreen
import app.hacklimits.shared.plan.InjuriesScreen
import app.hacklimits.shared.programs.ProgramsScreen
import app.hacklimits.shared.integrations.IntegrationsScreen
import app.hacklimits.shared.media.MealPhotoScreen
import app.hacklimits.shared.social.SocialScreen
import app.hacklimits.shared.trainer.business.TrainerBusinessScreen
import app.hacklimits.shared.trainer.clients.TrainerClientsScreen
import app.hacklimits.shared.ui.MoreDestination
import app.hacklimits.shared.ui.MoreTool
import app.hacklimits.shared.account.FindTrainerScreen
import app.hacklimits.shared.owner.OwnerApi
import app.hacklimits.shared.owner.OwnerScreen
import app.hacklimits.shared.media.FormCheckScreen
import app.hacklimits.shared.media.ImportCsvScreen
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import app.hacklimits.shared.settings.DisplayPreferences
import org.koin.core.parameter.parametersOf
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.SessionStore
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.telemetry.Telemetry
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.tab_food
import app.hacklimits.shared.resources.tab_more
import app.hacklimits.shared.resources.tab_progress
import app.hacklimits.shared.resources.tab_today
import app.hacklimits.shared.ui.LoggerScreen
import app.hacklimits.shared.ui.MoreScreen
import app.hacklimits.shared.ui.NutritionScreen
import app.hacklimits.shared.ui.OnboardingScreen
import app.hacklimits.shared.ui.PlanScreen
import app.hacklimits.shared.ui.ProgressScreen
import app.hacklimits.shared.ui.SignInScreen
import app.hacklimits.shared.ui.TodayScreen
import app.hacklimits.shared.ui.theme.HackLimitsIcons
import app.hacklimits.shared.ui.theme.HackLimitsTheme
import app.hacklimits.shared.workout.PendingSaves
import app.hacklimits.shared.update.Gate
import app.hacklimits.shared.update.UpdateReadyBar
import app.hacklimits.shared.update.UpdateRequiredScreen
import app.hacklimits.shared.update.UpdateViewModel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

@Serializable object TodayRoute
@Serializable object FoodRoute
@Serializable object ProgressRoute
@Serializable object MoreRoute
@Serializable object LoggerRoute
/** clientId = 0: your own plan; otherwise a trainer editing that client's plan. */
@Serializable data class PlanRoute(val clientId: Long = 0)
@Serializable object OnboardingRoute
@Serializable object CoachRoute
@Serializable object SocialRoute
@Serializable object IntegrationsRoute
@Serializable object MealPhotoRoute
@Serializable object TrainerClientsRoute
@Serializable object TrainerBusinessRoute
@Serializable object ExerciseLibraryRoute
@Serializable object ProgramsRoute
@Serializable object InjuriesRoute
@Serializable object InboxRoute
@Serializable object FindTrainerRoute
@Serializable object OwnerRoute
@Serializable object CardioRoute
@Serializable object ComebackRoute
@Serializable object TrainerReportRoute
@Serializable object ProgramSharingRoute
@Serializable object FormCheckRoute
@Serializable object ImportCsvRoute
/** peerId = 0: a client's own trainer; otherwise the client a trainer is talking to. */
@Serializable data class ChatRoute(val peerId: Long = 0)

/** A bottom-bar tab: its route, label and icon. Full-screen flows (workout, plan, questionnaire)
 * open above the tabs without the bar. */
private data class Tab(val route: Any, val label: StringResource, val icon: ImageVector, val event: String)

private val TABS = listOf(
    Tab(TodayRoute, Res.string.tab_today, HackLimitsIcons.Today, "app_nav_today"),
    // The Mini App names this tab "fuel"; the event keeps the same name on both apps.
    Tab(FoodRoute, Res.string.tab_food, HackLimitsIcons.Food, "app_nav_fuel"),
    Tab(ProgressRoute, Res.string.tab_progress, HackLimitsIcons.Progress, "app_nav_progress"),
    Tab(MoreRoute, Res.string.tab_more, HackLimitsIcons.More, "app_nav_more"),
)

/** Root: signed out -> sign-in; signed in -> the app. A 401 from the server signs out. */
@Composable
fun App(
    onSignedIn: () -> Unit = {},
    beforeSignOut: suspend () -> Unit = {},
    onRequestHealthPermission: () -> Unit = {},
    onRequestActivityPermission: () -> Unit = {},
) {
    val display = koinInject<DisplayPreferences>()
    val displayPrefs by display.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(display) { runCatching { display.load() } }
    HackLimitsTheme(displayPrefs) {
        Surface(Modifier.fillMaxSize()) {
            val sessions = koinInject<SessionStore>()
            val api = koinInject<ApiClient>()
            val auth = koinInject<AuthApi>()
            val pending = koinInject<PendingSaves>()
            val platform = koinInject<AppPlatform>()
            val telemetry = koinInject<Telemetry>()
            val scope = rememberCoroutineScope()
            val updates: UpdateViewModel = koinViewModel()
            val gate by updates.gate.collectAsStateWithLifecycle()
            val updateReady by updates.readyToInstall.collectAsStateWithLifecycle()
            if (gate == Gate.Required) {
                UpdateRequiredScreen(onUpdate = updates::update)
                return@Surface
            }
            val signedIn by sessions.signedIn.collectAsStateWithLifecycle()
            val accountId by sessions.account.collectAsStateWithLifecycle()
            // Signs out only if the rejected token is still the one stored, so a stale signal cannot end a newer sign-in.
            LaunchedEffect(api) { api.sessionExpired.filterNotNull().collect { rejected -> if (sessions.token() == rejected) sessions.clear() } }
            LaunchedEffect(signedIn, accountId) {
                if (signedIn) {
                    onSignedIn()
                    pending.scheduleIfPending()
                    runCatching { pending.flush() } // workouts saved offline last time
                }
            }
            if (!signedIn) {
                SignInScreen(koinViewModel())
                return@Surface
            }
            val nav = rememberNavController()
            val openView by OpenView.requested.collectAsStateWithLifecycle()
            LaunchedEffect(openView) {
                val view = openView ?: return@LaunchedEffect
                OpenView.consumed()
                routeForView(view)?.let { route -> nav.navigate(route) { launchSingleTop = true } }
            }
            val entry by nav.currentBackStackEntryAsState()
            val onTab = TABS.any { tab -> entry?.destination?.hasRoute(tab.route::class) == true }
            Scaffold(
                bottomBar = {
                    Column {
                        if (updateReady) UpdateReadyBar(onRestart = updates::install)
                        if (onTab) NavigationBar {
                            TABS.forEach { tab ->
                                NavigationBarItem(
                                    selected = entry?.destination?.hasRoute(tab.route::class) == true,
                                    onClick = {
                                        telemetry.track(tab.event)
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
                    }
                },
            ) { padding ->
                // Scaffold supplies the system-bar insets; consuming them stops a screen's imePadding counting them twice.
                NavHost(
                    nav,
                    startDestination = TodayRoute,
                    modifier = Modifier.padding(padding).consumeWindowInsets(padding),
                    enterTransition = {
                        if (displayPrefs.reducedMotion) EnterTransition.None
                        else fadeIn(tween(190)) + slideInHorizontally(tween(250)) { it / 24 }
                    },
                    exitTransition = {
                        if (displayPrefs.reducedMotion) ExitTransition.None
                        else fadeOut(tween(150)) + slideOutHorizontally(tween(180)) { -it / 32 }
                    },
                    popEnterTransition = {
                        if (displayPrefs.reducedMotion) EnterTransition.None
                        else fadeIn(tween(190)) + slideInHorizontally(tween(250)) { -it / 24 }
                    },
                    popExitTransition = {
                        if (displayPrefs.reducedMotion) ExitTransition.None
                        else fadeOut(tween(150)) + slideOutHorizontally(tween(180)) { it / 32 }
                    },
                ) {
                    composable<TodayRoute> {
                        TodayScreen(
                            koinViewModel(),
                            onStartWorkout = { nav.navigate(LoggerRoute) },
                            onOpenPlan = { nav.navigate(PlanRoute()) },
                            onStartQuestionnaire = { nav.navigate(OnboardingRoute) },
                            onOpenTraining = { nav.navigate(LoggerRoute) },
                            onAskCoach = { nav.navigate(CoachRoute) },
                            onOpenFood = { nav.navigate(FoodRoute) },
                            onOpenProgress = { nav.navigate(ProgressRoute) },
                            onOpenComeback = { nav.navigate(ComebackRoute) },
                        )
                    }
                    composable<FoodRoute> { NutritionScreen(koinViewModel(), onOpenMealPhoto = { nav.navigate(MealPhotoRoute) }) }
                    composable<ProgressRoute> { ProgressScreen(koinViewModel(), trainExtras = { StandardsCard() }) }
                    composable<MoreRoute> {
                        val ownerApi = koinInject<OwnerApi>()
                        var isOwner by remember { mutableStateOf(false) }
                        LaunchedEffect(ownerApi) { isOwner = ownerApi.isOwner() }
                        MoreScreen(
                            koinViewModel(),
                            privacyUrl = platform.privacyPolicyUrl,
                            onSignOut = { scope.launch { runCatching { beforeSignOut() }; auth.logout() } },
                            beforeSignOut = beforeSignOut,
                            onOpen = { destination ->
                                nav.navigate(
                                    when (destination) {
                                        MoreDestination.Coach -> CoachRoute
                                        MoreDestination.Social -> SocialRoute
                                        MoreDestination.Integrations -> IntegrationsRoute
                                        MoreDestination.TrainerClients -> TrainerClientsRoute
                                        MoreDestination.TrainerBusiness -> TrainerBusinessRoute
                                    },
                                )
                            },
                            isOwner = isOwner,
                            onOpenTool = { tool ->
                                when (tool) {
                                    MoreTool.Inbox -> nav.navigate(InboxRoute)
                                    MoreTool.Injuries -> nav.navigate(InjuriesRoute)
                                    MoreTool.FindTrainer -> nav.navigate(FindTrainerRoute)
                                    MoreTool.Programs -> nav.navigate(ProgramsRoute)
                                    MoreTool.Library -> nav.navigate(ExerciseLibraryRoute)
                                    MoreTool.Photos -> nav.navigate(ProgressRoute)
                                    MoreTool.WeekCard -> nav.navigate(TodayRoute)
                                    MoreTool.Owner -> nav.navigate(OwnerRoute)
                                    MoreTool.Cardio -> nav.navigate(CardioRoute)
                                    MoreTool.TrainerReport -> nav.navigate(TrainerReportRoute)
                                    MoreTool.ProgramSharing -> nav.navigate(ProgramSharingRoute)
                                    MoreTool.FormCheck -> nav.navigate(FormCheckRoute)
                                    MoreTool.ImportCsv -> nav.navigate(ImportCsvRoute)
                                    // The plate calculator sits in the workout overview, as in the Mini App.
                                    MoreTool.Plates -> nav.navigate(LoggerRoute)
                                }
                            },
                        )
                    }
                    composable<OnboardingRoute> {
                        OnboardingScreen(
                            koinViewModel(),
                            onDone = { nav.popBackStack() },
                            onClose = { nav.popBackStack() },
                            onFindTrainer = { nav.navigate(FindTrainerRoute) },
                            // "Become a coach" lives in More's profile section.
                            onBecomeCoach = { nav.navigate(MoreRoute) },
                        )
                    }
                    composable<PlanRoute> { entry ->
                        val clientId = entry.toRoute<PlanRoute>().clientId
                        PlanScreen(
                            koinViewModel(parameters = { if (clientId > 0) parametersOf(clientId) else parametersOf() }),
                            onClose = { nav.popBackStack() },
                            onOpenLibrary = { nav.navigate(ExerciseLibraryRoute) },
                        )
                    }
                    composable<ExerciseLibraryRoute> { ExerciseLibraryScreen(koinViewModel(), onBack = { nav.popBackStack() }) }
                    composable<ProgramsRoute> {
                        ProgramsScreen(koinViewModel(), onBack = { nav.popBackStack() }, onApplied = { nav.popBackStack() })
                    }
                    composable<InjuriesRoute> { InjuriesScreen(koinViewModel(), onBack = { nav.popBackStack() }) }
                    composable<CoachRoute> { CoachScreen(onBack = { nav.popBackStack() }) }
                    composable<SocialRoute> { SocialScreen(onBack = { nav.popBackStack() }, onOpenCoach = { nav.navigate(CoachRoute) }) }
                    composable<OwnerRoute> { OwnerScreen(onBack = { nav.popBackStack() }) }
                    composable<CardioRoute> { CardioScreen(onBack = { nav.popBackStack() }) }
                    composable<ComebackRoute> { ComebackScreen(onBack = { nav.popBackStack() }, onDone = { nav.popBackStack() }) }
                    composable<TrainerReportRoute> { TrainerReportScreen(onBack = { nav.popBackStack() }) }
                    composable<ProgramSharingRoute> { ProgramSharingScreen(onBack = { nav.popBackStack() }) }
                    composable<FormCheckRoute> { FormCheckScreen(onBack = { nav.popBackStack() }) }
                    composable<ImportCsvRoute> { ImportCsvScreen(onBack = { nav.popBackStack() }) }
                    composable<FindTrainerRoute> {
                        FindTrainerScreen(koinViewModel(), onBack = { nav.popBackStack() }, onAccepted = { nav.popBackStack() })
                    }
                    composable<InboxRoute> {
                        InboxScreen(
                            onBack = { nav.popBackStack() },
                            onOpen = { target ->
                                when (target) {
                                    InboxTarget.Plan -> nav.navigate(PlanRoute())
                                    InboxTarget.Progress -> nav.navigate(ProgressRoute)
                                    InboxTarget.Today -> nav.navigate(TodayRoute)
                                    InboxTarget.More -> nav.navigate(MoreRoute)
                                    InboxTarget.Role -> nav.navigate(CoachRoute)
                                }
                            },
                        )
                    }
                    composable<ChatRoute> { entry ->
                        val peerId = entry.toRoute<ChatRoute>().peerId
                        ChatScreen(peerId = peerId.takeIf { it > 0 }, onBack = { nav.popBackStack() })
                    }
                    composable<IntegrationsRoute> {
                        IntegrationsScreen(
                            onBack = { nav.popBackStack() },
                            onRequestHealthPermission = onRequestHealthPermission,
                            onRequestActivityPermission = onRequestActivityPermission,
                        )
                    }
                    composable<MealPhotoRoute> { MealPhotoScreen(onBack = { nav.popBackStack() }, onLogged = { nav.popBackStack() }) }
                    composable<TrainerClientsRoute> {
                        TrainerClientsScreen(
                            onBack = { nav.popBackStack() },
                            onOpenClientPlan = { id -> nav.navigate(PlanRoute(id)) },
                            onOpenChat = { id -> nav.navigate(ChatRoute(id)) },
                            onOpenCoach = { nav.navigate(CoachRoute) },
                            onOpenBusiness = { nav.navigate(TrainerBusinessRoute) },
                        )
                    }
                    composable<TrainerBusinessRoute> { TrainerBusinessScreen(onBack = { nav.popBackStack() }) }
                    composable<LoggerRoute> {
                        LoggerScreen(
                            koinViewModel(),
                            onClose = { nav.popBackStack() },
                            onAskCoach = { nav.navigate(CoachRoute) },
                            planContent = {
                                PlanScreen(koinViewModel(), onClose = {}, onOpenLibrary = { nav.navigate(ExerciseLibraryRoute) })
                            },
                        )
                    }
                }
            }
        }
    }
}

/** A notification's screen (the server's ?view= names) as a route; unknown names open nothing. */
private fun routeForView(view: String): Any? = when (view) {
    "today" -> TodayRoute
    "train" -> LoggerRoute
    "plan" -> PlanRoute()
    "fuel" -> FoodRoute
    "progress" -> ProgressRoute
    "more", "settings", "role" -> MoreRoute
    "library" -> ExerciseLibraryRoute
    "inbox" -> InboxRoute
    "coach" -> CoachRoute
    "onboarding" -> OnboardingRoute
    else -> null
}
