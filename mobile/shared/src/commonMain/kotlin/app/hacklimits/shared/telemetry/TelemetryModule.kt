package app.hacklimits.shared.telemetry

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.koin.core.module.Module
import org.koin.dsl.module

/** Feature-usage counters (crashes go through the platform ErrorReporter). */
val telemetryModule: Module = module {
    single { Telemetry(get(), CoroutineScope(SupervisorJob() + Dispatchers.Default)) }
}
