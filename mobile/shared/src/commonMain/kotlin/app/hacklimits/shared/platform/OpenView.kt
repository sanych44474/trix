package app.hacklimits.shared.platform

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * A screen a notification asked to open (the server's ?view= names, notify/appKeyboard.ts): the
 * platform sets it when a notification or one of its buttons is tapped, the app navigates and
 * clears it.
 */
object OpenView {
    private val pending = MutableStateFlow<String?>(null)
    val requested: StateFlow<String?> = pending

    fun request(view: String?) {
        if (!view.isNullOrBlank()) pending.value = view
    }

    fun consumed() {
        pending.value = null
    }
}
