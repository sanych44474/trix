package app.hacklimits.shared.platform

/** Lets the person choose where a file goes (Android: the system "Save to" picker). */
fun interface FileSaver {
    /** True when written; false when the person cancelled. */
    suspend fun save(suggestedName: String, mimeType: String, bytes: ByteArray): Boolean
}
