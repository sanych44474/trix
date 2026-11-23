package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.media.AudioRecorder
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Koin wiring for the trainer's client screens. The app includes it next to sharedModule. */
val trainerClientsModule: Module = module {
    single { TrainerClientsApi(get()) }
    single { TrainerLogApi(get()) }
    viewModel { TrainerClientsViewModel(get()) }
    viewModel { params -> TrainerClientLogViewModel(get(), get(), get(), get(), get(), params.get<Long>(), getOrNull<AudioRecorder>()) }
}
