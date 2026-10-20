package app.hacklimits.shared.data

import io.ktor.client.request.delete
import io.ktor.client.request.post
import io.ktor.http.isSuccess

/** Registers this install's push address with the server (src/webapp/pushApi.ts). [kind] is "fid"
 * (Firebase Installation ID, FCM 25.1+) or "token" (legacy registration token). */
class PushApi(private val api: ApiClient) {
    suspend fun register(token: String, platform: String, appVersion: String, kind: String = "fid"): Boolean =
        api.http.post("api/v2/push/devices") {
            api.authorize(this)
            json(mapOf("token" to token, "platform" to platform, "appVersion" to appVersion, "kind" to kind))
        }.status.isSuccess()

    suspend fun unregister(token: String) {
        runCatching { api.http.delete("api/v2/push/devices") { api.authorize(this); json(mapOf("token" to token)) } }
    }
}
