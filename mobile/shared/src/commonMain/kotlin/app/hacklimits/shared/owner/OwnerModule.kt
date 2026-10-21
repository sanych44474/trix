package app.hacklimits.shared.owner

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** The owner console. The lead shows its entry only when [OwnerApi.isOwner] is true. */
val ownerModule: Module = module {
    single { OwnerApi(get()) }
    viewModel { OwnerViewModel(get()) }
    viewModel { FeedbackTriageViewModel(get()) }
    viewModel { BroadcastViewModel(get()) }
}
