package app.hacklimits.shared.di

import app.hacklimits.shared.auth.SignInViewModel
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.AuthApi
import app.hacklimits.shared.data.DashboardApi
import app.hacklimits.shared.data.PushApi
import app.hacklimits.shared.today.TodayViewModel
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Everything platform-neutral. The platform supplies a SessionStore, a GoogleSignIn and the
 * AppPlatform through its own module (androidApp/.../AppModule.kt). */
fun sharedModule(baseUrl: String) = module {
    single { ApiClient(baseUrl, get()) }
    single { AuthApi(get(), get()) }
    single { DashboardApi(get()) }
    single { PushApi(get()) }
    viewModel { SignInViewModel(get(), get(), get()) }
    viewModel { TodayViewModel(get()) }
}
