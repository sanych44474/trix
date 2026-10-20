package app.hacklimits.shared.integrations

import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

/**
 * Integrations bindings. HealthSync is deliberately not bound here: each platform binds its own
 * (Android: HealthConnectSync, others: NoHealthSync) next to the other platform bindings.
 */
val integrationsModule: Module = module {
    single { StravaApi(get()) }
    viewModel { IntegrationsViewModel(get(), get(), get()) }
}
