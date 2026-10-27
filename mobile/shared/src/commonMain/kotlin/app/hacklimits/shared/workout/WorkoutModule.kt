package app.hacklimits.shared.workout

import app.hacklimits.shared.data.WorkoutApi
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for the workout logger. The app adds it to its module list; sharedModule is not touched. */
val workoutModule: Module = module {
    single { WorkoutApi(get()) }
    single { PendingSaves(get(), get(), get(), get(), get(), get(), get()) }
    viewModel { LoggerViewModel(get(), get(), get(), get(), get()) }
}
