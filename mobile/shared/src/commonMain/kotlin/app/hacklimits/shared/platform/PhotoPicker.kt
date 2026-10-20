package app.hacklimits.shared.platform

/** A photo the person picked, already resized for upload. */
class PickedPhoto(val bytes: ByteArray, val mimeType: String)

/** The system photo picker (Android: no storage permission needed). Null when cancelled. */
fun interface PhotoPicker {
    suspend fun pick(): PickedPhoto?
}
