package app.hacklimits.shared.trainertools

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for the trainer tools and the owner cleanup card. Needs TrainerClientsApi in the graph (trainerClientsModule). */
val trainerToolsModule: Module = module {
    single { TrainerToolsApi(get()) }
    viewModel { ProgramSharingViewModel(get(), get()) }
    viewModel { TrainerReportViewModel(get()) }
    viewModel { OwnerCleanupViewModel(get()) }
}
