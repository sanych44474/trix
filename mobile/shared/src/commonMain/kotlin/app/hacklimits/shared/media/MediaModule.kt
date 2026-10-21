package app.hacklimits.shared.media

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/**
 * Meal photo and food-description input, form check, CSV import. The platform binds SpeechInput
 * (NoSpeechInput until it has recognition), MediaFilePicker and, optionally, AudioRecorder.
 */
val mediaModule: Module = module {
    single { MediaApi(get()) }
    viewModel { MealPhotoViewModel(get(), get(), get(), get(), get(), getOrNull<AudioRecorder>()) }
    viewModel { FormCheckViewModel(get(), get(), get()) }
    viewModel { ImportCsvViewModel(get(), get(), get()) }
}
