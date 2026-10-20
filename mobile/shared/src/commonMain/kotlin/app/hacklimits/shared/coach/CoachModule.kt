package app.hacklimits.shared.coach

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wired into the app's Koin graph by the host; needs an ApiClient binding from the shared module. */
val coachModule: Module = module {
    single { CoachApi(get()) }
    viewModel { CoachViewModel(get()) }
}
