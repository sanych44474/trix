package app.hacklimits.shared.inbox

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/**
 * Wiring for the feed and the unread badge. Needs ApiClient (shared module) and ChatApi (chatModule).
 * The host adds it to its module list; sharedModule is not touched.
 */
val inboxModule: Module = module {
    single { InboxApi(get()) }
    viewModel { InboxViewModel(get()) }
    viewModel { UnreadBadgeViewModel(get(), get()) }
}
