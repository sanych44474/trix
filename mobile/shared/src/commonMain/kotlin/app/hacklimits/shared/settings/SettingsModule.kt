package app.hacklimits.shared.settings

import app.hacklimits.shared.account.FindTrainerViewModel
import app.hacklimits.shared.account.TrainerApi
import app.hacklimits.shared.account.WhatsNewApi
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for More's profile, invite, trainer, What's new and display parts. MoreViewModel stays where
 * it is (SharedModule). The app adds this module to its module list. */
val settingsModule: Module = module {
    single { ProfileApi(get()) }
    single { DisplayPreferences(get()) }
    single { TrainerApi(get()) }
    single { WhatsNewApi(get()) }
    viewModel { ProfileViewModel(get(), get(), get(), get()) }
    viewModel { FindTrainerViewModel(get()) }
}
