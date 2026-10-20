package app.hacklimits.shared.telemetry

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.koin.core.module.Module
import org.koin.dsl.module

/** Usage counters and crash reports. Both need the ApiClient; they share one background scope. */
val telemetryModule: Module = module {
    single { Telemetry(get(), CoroutineScope(SupervisorJob() + Dispatchers.Default)) }
    single { ClientErrorReporter(get(), CoroutineScope(SupervisorJob() + Dispatchers.Default)) }
}
