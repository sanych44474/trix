package app.hacklimits.shared.integrations

/**
 * Reads steps from the platform's health store. Android implements it with Health Connect; other
 * platforms bind [NoHealthSync] until they have one. Bound per platform, never in the shared module.
 */
interface HealthSync {
    suspend fun available(): Boolean
    suspend fun hasPermission(): Boolean

    /** Today's step count so far, or null when the store has no steps for today. */
    suspend fun todaySteps(): Long?
}

object NoHealthSync : HealthSync {
    override suspend fun available(): Boolean = false
    override suspend fun hasPermission(): Boolean = false
    override suspend fun todaySteps(): Long? = null
}
