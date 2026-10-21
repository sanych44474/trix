package app.hacklimits.shared.trainingextras

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for the training extras (cardio, standards, comeback). The app adds it to its module list; sharedModule is not touched. */
val trainingExtrasModule: Module = module {
    single { TrainingExtrasApi(get()) }
    viewModel { CardioViewModel(get()) }
    viewModel { StandardsViewModel(get()) }
    viewModel { ComebackViewModel(get()) }
}
