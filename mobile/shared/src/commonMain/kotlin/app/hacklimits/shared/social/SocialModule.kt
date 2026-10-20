package app.hacklimits.shared.social

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for the Social screen. The app adds it to its module list; sharedModule is not touched. */
val socialModule: Module = module {
    single { SocialApi(get()) }
    viewModel { SocialViewModel(get()) }
}
