package app.hacklimits.shared.media

/** On-device speech to text. Null when nothing was heard or recognition is unavailable. */
interface SpeechInput {
    suspend fun listen(languageTag: String): String?
}

/** Until a platform provides recognition. The mic button is hidden for this implementation. */
object NoSpeechInput : SpeechInput {
    override suspend fun listen(languageTag: String): String? = null
}
