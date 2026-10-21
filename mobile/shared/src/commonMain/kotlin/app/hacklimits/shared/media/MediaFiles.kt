package app.hacklimits.shared.media

/** What the person is picking: a training clip or a CSV export. */
enum class MediaFileKind { VIDEO, CSV }

/**
 * A file the person picked. Size and length are known before the bytes are read, so an oversize
 * clip is refused without loading it into memory.
 */
class PickedFile(
    val name: String,
    val mimeType: String,
    val sizeBytes: Long,
    /** Length of a video in seconds; null when the platform cannot tell. */
    val seconds: Double?,
    private val read: suspend () -> ByteArray,
) {
    suspend fun bytes(): ByteArray = read()
}

/** The system file picker (Android: the document / video picker, no storage permission). Null when cancelled. */
fun interface MediaFilePicker {
    suspend fun pick(kind: MediaFileKind): PickedFile?
}

/** A voice clip from the platform recorder, in the format the platform wrote. */
class RecordedAudio(val bytes: ByteArray, val mimeType: String, val fileExtension: String)

/**
 * Records a voice note for the server transcription fallback. The platform owns the microphone
 * permission and the recorder; the recorder stops itself after [MAX_VOICE_SECONDS].
 */
interface AudioRecorder {
    /** False when the microphone cannot be used (no permission, already busy). */
    suspend fun start(): Boolean

    /** Ends the clip and returns it, or null when nothing was recorded. */
    suspend fun stop(): RecordedAudio?
}
