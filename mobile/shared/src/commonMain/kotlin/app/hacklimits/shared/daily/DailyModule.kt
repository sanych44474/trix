package app.hacklimits.shared.daily

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wired into the app's Koin graph by the host; needs an ApiClient binding from the shared module. */
val dailyModule: Module = module {
    single { DailyApi(get()) }
    viewModel { DailyViewModel(get()) }
}
