package app.hacklimits.shared.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.timeout
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import io.ktor.serialization.ContentConvertException
import app.hacklimits.shared.platform.ErrorReporter
import io.ktor.client.statement.request
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** A failed call: the HTTP status and the server's error code ("invalid_code", "rate_limited", ...). */
/** [retryable] is the server's verdict from the error envelope; null when the server didn't say. */
class ApiException(val status: Int, val code: String, message: String?, val retryable: Boolean? = null) : Exception(message ?: code)

/**
 * The one HTTP client. Every request identifies itself as the native app (the server then returns
 * session tokens in the body instead of a cookie) and carries the bearer session when there is one.
 * A 401 on an authenticated call means the session is gone: [sessionExpired] tells the UI.
 */
class ApiClient(
    private val baseUrl: String,
    private val sessions: SessionStore,
    engine: HttpClient? = null,
    val reporter: ErrorReporter = ErrorReporter.None,
) {
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

    /** A session saved before the app stored account ids has none, which locks its offline data away.
     *  Adopt the id the server reports for the signed-in viewer; an id already stored is never replaced. */
    suspend fun adoptAccountId(id: Long) {
        if (id == 0L || sessions.accountId() != null) return
        val token = sessions.token() ?: return
        sessions.save(token, id)
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
        if (response.status.isSuccess()) {
            return try {
                response.body<Envelope<T>>().data
            } catch (e: ContentConvertException) {
                throw undecodable(response, e)
            }
        }
        throw errorOf(response)
    }

    /** A 2xx the app can't read is an app/server mismatch, not a connection problem: report it. */
    fun undecodable(response: HttpResponse, error: Throwable): ApiException {
        reporter.record(error, "decode ${response.request.url.encodedPath}")
        return ApiException(response.status.value, "bad_response", error.message)
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
        val retryable = ((body?.get("error") as? JsonObject)?.get("retryable") as? JsonPrimitive)?.booleanOrNull
        return ApiException(response.status.value, specific ?: code ?: "http_${response.status.value}", message, retryable)
    }

    private companion object {
        val GENERIC_CODES = setOf("validation_error", "conflict", "forbidden", "not_found", "dependency_unavailable")
        val SPECIFIC = Regex("^[a-z][a-z0-9_]{2,40}$")
    }
}

@kotlinx.serialization.Serializable
data class Envelope<T>(val data: T)

private const val AI_TIMEOUT_MS = 120_000L

/** AI-backed calls: the server may try several providers (25 s each) before it answers. */
fun HttpRequestBuilder.aiTimeout() = timeout {
    requestTimeoutMillis = AI_TIMEOUT_MS
    socketTimeoutMillis = AI_TIMEOUT_MS
}
