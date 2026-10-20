package app.hacklimits.shared.di

import app.hacklimits.shared.auth.SignInViewModel
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.PushApi
import app.hacklimits.shared.data.WorkoutApi
import app.hacklimits.shared.data.PlanApi
import app.hacklimits.shared.plan.PlanViewModel
import app.hacklimits.shared.workout.LoggerViewModel
import app.hacklimits.shared.workout.PendingSaves
import app.hacklimits.shared.today.TodayViewModel
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Everything platform-neutral. The platform supplies a SessionStore, a GoogleSignIn and the
 * AppPlatform, a KeyValueStore and a RestAlarm through its own module (androidApp/.../AppModule.kt). */
fun sharedModule(baseUrl: String) = module {
    single { ApiClient(baseUrl, get()) }
    single { AuthApi(get(), get()) }
    single { DashboardApi(get()) }
    single { PushApi(get()) }
    single { WorkoutApi(get()) }
    single { PlanApi(get()) }
    single { PendingSaves(get(), get()) }
    viewModel { SignInViewModel(get(), get(), get()) }
    viewModel { TodayViewModel(get()) }
    viewModel { PlanViewModel(get()) }
    viewModel { LoggerViewModel(get(), get(), get(), get()) }
}
