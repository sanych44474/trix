package app.hacklimits.shared.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** A failed call: the HTTP status and the server's error code ("invalid_code", "rate_limited", ...). */
class ApiException(val status: Int, val code: String, message: String?) : Exception(message ?: code)

/**
 * The one HTTP client. Every request identifies itself as the native app (the server then returns
 * session tokens in the body instead of a cookie) and carries the bearer session when there is one.
 * A 401 on an authenticated call means the session is gone: [sessionExpired] tells the UI.
 */
class ApiClient(private val baseUrl: String, private val sessions: SessionStore, engine: HttpClient? = null) {
    private val expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = expired

    val http: HttpClient = (engine ?: HttpClient()).config {
        expectSuccess = false
        install(ContentNegotiation) { json(AppJson) }
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 30_000
        }
        defaultRequest {
            url(baseUrl.trimEnd('/') + "/")
            header("X-Client", "native")
        }
    }

    /** An absolute URL on the API origin, for things loaded outside Ktor (images). */
    fun url(path: String): String = baseUrl.trimEnd('/') + "/" + path.trimStart('/')

    /** The bearer header value for requests made outside Ktor (images); null when signed out. */
    suspend fun bearer(): String? = sessions.token()?.let { "Bearer $it" }

    suspend fun authorize(builder: HttpRequestBuilder) {
        sessions.token()?.let { builder.bearerAuth(it) }
    }

    /** Decode `{ data: T }` (v2 routes add `meta`), or throw [ApiException] with the server's code. */
    suspend inline fun <reified T> unwrap(response: HttpResponse): T {
        if (response.status.isSuccess()) return response.body<Envelope<T>>().data
        throw errorOf(response)
    }

    suspend fun errorOf(response: HttpResponse): ApiException {
        if (response.status.value == 401 && sessions.token() != null) expired.tryEmit(Unit)
        val body = runCatching { response.body<JsonObject>() }.getOrNull()
        val (code, message) = when (val e: JsonElement? = body?.get("error")) {
            is JsonObject -> (e["code"] as? JsonPrimitive)?.contentOrNull to (e["message"] as? JsonPrimitive)?.contentOrNull
            is JsonPrimitive -> e.contentOrNull to null
            else -> null to null
        }
        // v2 routes put the legacy handler's specific code (e.g. "no_telegram_chat") in `message`
        // under a generic `code` ("conflict"); the specific one is what the screen needs.
        val specific = message?.takeIf { code in GENERIC_CODES && SPECIFIC.matches(it) }
        return ApiException(response.status.value, specific ?: code ?: "http_${response.status.value}", message)
    }

    private companion object {
        val GENERIC_CODES = setOf("validation_error", "conflict", "forbidden", "not_found", "dependency_unavailable")
        val SPECIFIC = Regex("^[a-z][a-z0-9_]{2,40}$")
    }
}

@kotlinx.serialization.Serializable
data class Envelope<T>(val data: T)
