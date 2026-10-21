package app.hacklimits.shared.plan

import app.hacklimits.shared.programs.ProgramsApi
import app.hacklimits.shared.programs.ProgramsViewModel
import app.hacklimits.shared.programs.SharedProgramsApi
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Plan, library, programs, injuries and fine-tune. Needs the ApiClient and PlanApi bindings of sharedModule. */
val planModule: Module = module {
    single { FineTuneApi(get()) }
    single { InjuriesApi(get()) }
    single { ProgramsApi(get()) }
    single { SharedProgramsApi(get()) }
    viewModel { ProgramsViewModel(get(), get(), get()) }
    viewModel { InjuriesViewModel(get()) }
    viewModel { ExerciseLibraryViewModel(get()) }
}
