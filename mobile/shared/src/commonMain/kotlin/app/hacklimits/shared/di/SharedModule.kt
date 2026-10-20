package app.hacklimits.shared.di

import app.hacklimits.shared.auth.SignInViewModel
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ClientErrorApi
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.PushApi
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.data.SettingsApi
import app.hacklimits.shared.data.ProgressApi
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.TrackingApi
import app.hacklimits.shared.today.QuickLogViewModel
import app.hacklimits.shared.nutrition.NutritionViewModel
import app.hacklimits.shared.progress.ProgressViewModel
import app.hacklimits.shared.settings.MoreViewModel
import app.hacklimits.shared.data.OnboardingApi
import app.hacklimits.shared.onboarding.OnboardingViewModel
import app.hacklimits.shared.plan.PlanViewModel
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.PendingSaves
import app.hacklimits.shared.today.TodayViewModel
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module
import app.hacklimits.shared.platform.ErrorReporter
import app.hacklimits.shared.update.AppConfigApi
import app.hacklimits.shared.update.UpdateViewModel
import app.hacklimits.shared.coach.coachModule
import app.hacklimits.shared.plan.planModule
import app.hacklimits.shared.integrations.integrationsModule
import app.hacklimits.shared.media.mediaModule
import app.hacklimits.shared.social.socialModule
import app.hacklimits.shared.trainer.business.trainerBusinessModule
import app.hacklimits.shared.trainer.clients.trainerClientsModule

/** Everything platform-neutral. The platform supplies a SessionStore, a GoogleSignIn and the
 * AppPlatform, a KeyValueStore, a RestAlarm, a FileSaver, a PhotoPicker, a SpeechInput and a HealthSync through its own module (androidApp/.../AppModule.kt). */
fun sharedModule(baseUrl: String) = module {
    includes(planModule, coachModule, socialModule, trainerClientsModule, trainerBusinessModule, mediaModule, integrationsModule)
    single { ApiClient(baseUrl, get(), reporter = getOrNull<ErrorReporter>() ?: ErrorReporter.None) }
    single { AppConfigApi(get()) }
    single { ClientErrorApi(get()) }
    viewModel { UpdateViewModel(get(), get(), get()) }
    single { AuthApi(get(), get()) }
    single { DashboardApi(get()) }
    single { PushApi(get()) }
    single { WorkoutApi(get()) }
    single { PlanApi(get()) }
    single { SettingsApi(get()) }
    single { ProgressApi(get()) }
    single { NutritionApi(get()) }
    single { TrackingApi(get()) }
    single { OnboardingApi(get()) }
    single { PendingSaves(get(), get()) }
    viewModel { SignInViewModel(get(), get(), get()) }
    viewModel { TodayViewModel(get()) }
    viewModel { params -> PlanViewModel(get(), params.getOrNull<Long>()) }
    viewModel { NutritionViewModel(get()) }
    viewModel { QuickLogViewModel(get()) }
    viewModel { ProgressViewModel(get(), get(), get(), get()) }
    viewModel { MoreViewModel(get(), get(), get(), get(), get(), get()) }
    viewModel { OnboardingViewModel(get()) }
    viewModel { LoggerViewModel(get(), get(), get(), get()) }
}
