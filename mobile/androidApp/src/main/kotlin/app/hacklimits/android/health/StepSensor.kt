package app.hacklimits.android.health

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.hacklimits.shared.integrations.decodeStepBaseline
import app.hacklimits.shared.integrations.encodeStepBaseline
import app.hacklimits.shared.integrations.readSteps
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The phone's hardware step counter, for when Health Connect has no steps (nothing syncs to it).
 * The counter runs since boot, so today's steps come from a remembered start-of-day value
 * (StepBaseline); an hourly worker takes a reading so the day's start is caught within the hour.
 */
class StepSensor(private val context: Context) {
    private val sensors = context.getSystemService(SensorManager::class.java)
    private val prefs by lazy { context.getSharedPreferences("steps", Context.MODE_PRIVATE) }

    fun available(): Boolean = sensors?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null

    fun granted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    /** Today's steps, or null without the sensor, the permission or a reading. */
    suspend fun todaySteps(): Long? {
        if (!available() || !granted()) return null
        val counter = read() ?: return null
        return withContext(Dispatchers.IO) {
            val reading = readSteps(decodeStepBaseline(prefs.getString(KEY, null)), LocalDate.now().toString(), counter)
            prefs.edit { putString(KEY, encodeStepBaseline(reading.baseline)) }
            reading.stepsToday
        }
    }

    /** One value from the counter; it reports on registration, so this returns quickly. */
    private suspend fun read(): Long? {
        val sensor = sensors?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
        return withTimeoutOrNull(5_000) {
            suspendCancellableCoroutine { cont ->
                val listener = object : SensorEventListener {
                    override fun onSensorChanged(event: SensorEvent) {
                        sensors.unregisterListener(this)
                        if (cont.isActive) cont.resume(event.values[0].toLong())
                    }

                    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
                }
                sensors.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
                cont.invokeOnCancellation { sensors.unregisterListener(listener) }
            }
        }
    }

    /** Starts the hourly reading (no-op without the permission; replaced, not duplicated). */
    fun schedule() {
        if (!available() || !granted()) return
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<StepSnapshotWorker>(1, TimeUnit.HOURS).build(),
        )
    }

    private companion object {
        const val KEY = "baseline"
        const val WORK = "step-snapshot"
    }
}

/** Takes a counter reading so the start of each day is remembered even when the app isn't opened. */
class StepSnapshotWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        StepSensor(applicationContext).todaySteps()
        return Result.success()
    }
}
