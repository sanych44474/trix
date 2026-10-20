package app.hacklimits.shared.trainer.business

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Registered by the app's Koin setup; needs ApiClient from the shared module. */
val trainerBusinessModule: Module = module {
    single { TrainerBusinessApi(get()) }
    viewModel { TrainerBusinessViewModel(get()) }
}
