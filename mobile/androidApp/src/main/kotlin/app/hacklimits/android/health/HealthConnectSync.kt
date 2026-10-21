package app.hacklimits.android.health

import java.time.Duration
import androidx.health.connect.client.request.ReadRecordsRequest
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import android.provider.Settings
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
 * Health Connect steps, plus the phone's own step counter ([StepSensor]) for when nothing syncs
 * steps into Health Connect (Samsung Health, Google Fit... are the usual writers).
 */
class HealthConnectSync(private val context: Context, private val sensor: StepSensor = StepSensor(context)) : HealthSync {
    private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

    override suspend fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    // Set by disconnect(); Health Connect keeps reporting a revoked grant until the app restarts.
    private val prefs by lazy { context.getSharedPreferences("health", Context.MODE_PRIVATE) }

    override suspend fun hasPermission(): Boolean =
        !prefs.getBoolean(KEY_OFF, false) && STEPS in client.permissionController.getGrantedPermissions()

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

    override suspend fun stepSources(): List<String> {
        if (!hasPermission()) return emptyList()
        val since = Instant.now().minus(Duration.ofDays(7))
        val records = client.readRecords(ReadRecordsRequest(StepsRecord::class, TimeRangeFilter.after(since), pageSize = 200)).records
        return records.map { it.metadata.dataOrigin.packageName }.distinct().map(::appName)
    }

    override fun openSettings() {
        val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
        }
    }

    override suspend fun disconnect() {
        prefs.edit().putBoolean(KEY_OFF, true).apply()
        client.permissionController.revokeAllPermissions()
    }

    override fun reconnect() {
        prefs.edit().remove(KEY_OFF).apply()
    }

    override fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
        }
    }

    override fun sensorAvailable(): Boolean = sensor.available()

    override fun sensorGranted(): Boolean = sensor.granted()

    override suspend fun sensorSteps(): Long? = sensor.todaySteps()

    /** A readable name for a writer; package visibility may hide the label, so the usual ones are known. */
    private fun appName(pkg: String): String = KNOWN_WRITERS[pkg]
        ?: runCatching { context.packageManager.run { getApplicationLabel(getApplicationInfo(pkg, 0)).toString() } }.getOrDefault(pkg)

    companion object {
        private const val KEY_OFF = "health_connect_off"

        private val KNOWN_WRITERS = mapOf(
            "com.sec.android.app.shealth" to "Samsung Health",
            "com.google.android.apps.fitness" to "Google Fit",
            "com.fitbit.FitbitMobile" to "Fitbit",
            "com.huawei.health" to "Huawei Health",
            "com.xiaomi.wearable" to "Mi Fitness",
        )

        val STEPS: String = HealthPermission.getReadPermission(StepsRecord::class)

        /** Pass to an ActivityResultLauncher created with [permissionContract]. */
        val PERMISSIONS: Set<String> = setOf(STEPS)

        /** Create once per Activity with registerForActivityResult; the result is the granted set. */
        fun permissionContract() = PermissionController.createRequestPermissionResultContract()
    }
}
