package app.hacklimits.shared.platform

/**
 * Where unexpected failures go (a response the app can't decode, a crash). The platform sends them
 * to its crash reporter and the server's error log; never pass personal data in [where].
 */
fun interface ErrorReporter {
    fun record(error: Throwable, where: String)

    companion object {
        val None = ErrorReporter { _, _ -> }
    }
}
