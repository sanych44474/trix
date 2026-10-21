package app.hacklimits.shared.chat

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/** Wiring for the chat. The host adds it to its module list; sharedModule is not touched. */
val chatModule: Module = module {
    single { ChatApi(get()) }
    // Parameter: the peer id, or 0 for the client's own trainer.
    viewModel { params -> ChatViewModel(get(), params.get<Long>().takeIf { it > 0L }) }
}
