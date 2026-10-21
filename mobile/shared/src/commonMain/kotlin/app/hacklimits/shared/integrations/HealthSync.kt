package app.hacklimits.shared.integrations

/**
 * Today's steps from the phone's health store (Android: Health Connect) and, as a fallback, the
 * phone's own step counter. Health Connect only has steps that another app (Samsung Health, Google
 * Fit...) wrote there, so an empty store usually means that app isn't syncing to it.
 */
interface HealthSync {
    suspend fun available(): Boolean
    suspend fun hasPermission(): Boolean

    /** Today's step count so far, or null when the store has no steps for today. */
    suspend fun todaySteps(): Long?

    /** Names of the apps that wrote steps to the store in the last week; empty when none did. */
    suspend fun stepSources(): List<String> = emptyList()

    /** Opens the health store's own settings (where syncing apps are managed). */
    fun openSettings() {}

    /** The phone has a hardware step counter. */
    fun sensorAvailable(): Boolean = false

    /** The step-counter permission (Android: physical activity) is granted. */
    fun sensorGranted(): Boolean = false

    /** Today's steps from the phone's counter (counted since the app first read it today), or null. */
    suspend fun sensorSteps(): Long? = null
}

object NoHealthSync : HealthSync {
    override suspend fun available(): Boolean = false
    override suspend fun hasPermission(): Boolean = false
    override suspend fun todaySteps(): Long? = null
}
