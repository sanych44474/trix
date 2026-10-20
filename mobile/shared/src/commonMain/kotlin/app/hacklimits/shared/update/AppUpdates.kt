package app.hacklimits.shared.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.platform.AppPlatform
import io.ktor.client.request.get
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable data class VersionGate(val minVersionCode: Int = 1, val latestVersionCode: Int = 1)
@Serializable private data class AppConfig(val android: VersionGate = VersionGate())

class AppConfigApi(private val api: ApiClient) {
    suspend fun android(): VersionGate = api.unwrap<AppConfig>(api.http.get("api/v2/app/config")).android
}

/** The store's own update flow (Play In-App Updates on Android). */
interface AppUpdater {
    /** True once a background (flexible) update has downloaded and waits for a restart. */
    val readyToInstall: StateFlow<Boolean>

    /** Starts the store's update flow; false when it can't (e.g. not installed from the store). */
    suspend fun start(immediate: Boolean): Boolean

    /** Restarts into a downloaded flexible update. */
    fun install()

    /** The app's store page, for when the in-app flow is unavailable. */
    fun openStore()
}

enum class Gate {
    /** Below the server's minimum: every screen, sign-in included, is blocked until it updates. */
    Required,
    /** Below the newest build: a background update was offered. */
    Optional,
    Current,
}

/** Pure, so the comparison is tested without a server: 0 (unknown build) is never gated. */
fun decide(versionCode: Int, gate: VersionGate): Gate = when {
    versionCode <= 0 -> Gate.Current
    versionCode < gate.minVersionCode -> Gate.Required
    versionCode < gate.latestVersionCode -> Gate.Optional
    else -> Gate.Current
}

class UpdateViewModel(private val api: AppConfigApi, private val platform: AppPlatform, private val updater: AppUpdater) : ViewModel() {
    private val _gate = MutableStateFlow(Gate.Current)
    val gate: StateFlow<Gate> = _gate.asStateFlow()
    val readyToInstall: StateFlow<Boolean> = updater.readyToInstall

    init {
        viewModelScope.launch {
            // Offline or an old server: never lock anyone out on a failed check.
            val config = runCatching { api.android() }.getOrNull() ?: return@launch
            val gate = decide(platform.versionCode, config)
            _gate.value = gate
            when (gate) {
                Gate.Required -> updater.start(immediate = true)
                Gate.Optional -> updater.start(immediate = false)
                Gate.Current -> Unit
            }
        }
    }

    fun update() {
        viewModelScope.launch { if (!updater.start(immediate = true)) updater.openStore() }
    }

    fun install() = updater.install()
}
