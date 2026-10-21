package app.hacklimits.shared.data

import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

@Serializable private class ClientError(val message: String, val source: String, val line: Int = 0, val surface: String = "native")

/** POST /api/v2/client-error: lands in the server's error log and the owner report. Best effort. */
class ClientErrorApi(private val api: ApiClient) {
    suspend fun report(message: String, where: String) {
        runCatching {
            api.http.post("api/v2/client-error") {
                api.authorize(this)
                contentType(ContentType.Application.Json)
                setBody(ClientError(message.take(160), where.take(80)))
            }
        }
    }
}
