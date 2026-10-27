package app.hacklimits.shared.platform

/** "Rest is over" while the app is in the background: a local notification, no server round-trip.
 * The screen shows its own countdown while it is open. */
interface RestAlarm {
    fun schedule(seconds: Int, title: String, body: String)
    fun cancel()
}
