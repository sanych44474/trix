package app.hacklimits.shared.data

import io.ktor.client.request.delete
import io.ktor.client.request.post
import io.ktor.http.isSuccess

/** Registers this install's push token with the server (src/webapp/pushApi.ts). */
class PushApi(private val api: ApiClient) {
    suspend fun register(token: String, platform: String, appVersion: String): Boolean =
        api.http.post("api/v2/push/devices") {
            api.authorize(this)
            json(mapOf("token" to token, "platform" to platform, "appVersion" to appVersion))
        }.status.isSuccess()

    suspend fun unregister(token: String) {
        runCatching { api.http.delete("api/v2/push/devices") { api.authorize(this); json(mapOf("token" to token)) } }
    }
}
