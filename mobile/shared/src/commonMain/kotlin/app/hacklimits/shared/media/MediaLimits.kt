package app.hacklimits.shared.media

// Upload limits the server enforces (src/features/workout/formCheck.ts, importCsv.ts).
internal const val MAX_VIDEO_BYTES = 14L * 1024 * 1024
internal const val MAX_VIDEO_SECONDS = 60
internal const val MAX_CSV_BYTES = 3L * 1024 * 1024
internal const val MAX_VOICE_SECONDS = 60

internal enum class ClipGate { OK, TOO_BIG, TOO_LONG }

/** The same size and length gate the Mini App runs before uploading. Length is checked only when known. */
internal fun clipGate(bytes: Long, seconds: Double?): ClipGate = when {
    bytes > MAX_VIDEO_BYTES -> ClipGate.TOO_BIG
    seconds != null && seconds > MAX_VIDEO_SECONDS + 0.5 -> ClipGate.TOO_LONG
    else -> ClipGate.OK
}
