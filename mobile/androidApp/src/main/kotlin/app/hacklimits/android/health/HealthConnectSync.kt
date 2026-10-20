package app.hacklimits.android.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.hacklimits.shared.integrations.HealthSync
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Health Connect steps. Kept as .kt.txt until androidx.health.connect:connect-client is added to the
 * build (see mobile/androidApp/HEALTH_CONNECT.md); rename to .kt then.
 */
class HealthConnectSync(private val context: Context) : HealthSync {
    private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

    override suspend fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    override suspend fun hasPermission(): Boolean = STEPS in client.permissionController.getGrantedPermissions()

    override suspend fun todaySteps(): Long? {
        // aggregate() throws SecurityException without the grant, so check first.
        if (!hasPermission()) return null
        // Midnight in the phone's zone, not UTC: "today" is the user's day.
        val zone = ZoneId.systemDefault()
        val start = LocalDate.now(zone).atStartOfDay(zone).toInstant()
        val request = AggregateRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL),
            timeRangeFilter = TimeRangeFilter.between(start, Instant.now()),
            dataOriginFilter = emptySet(),
        )
        return client.aggregate(request)[StepsRecord.COUNT_TOTAL]
    }

    companion object {
        val STEPS: String = HealthPermission.getReadPermission(StepsRecord::class)

        /** Pass to an ActivityResultLauncher created with [permissionContract]. */
        val PERMISSIONS: Set<String> = setOf(STEPS)

        /** Create once per Activity with registerForActivityResult; the result is the granted set. */
        fun permissionContract() = PermissionController.createRequestPermissionResultContract()
    }
}
