package app.hacklimits.shared.trainer.business

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

// Shapes follow the handlers, not the contract: trainerApi.ts (templates, broadcast),
// trainerScheduleApi.ts (sessions, finance) and extrasApi.ts (profile). The v2 wrapper adds { data, meta }.
// Money is Double because the server does not promise whole numbers on read; it is shown as given.

@Serializable data class BusinessClient(val id: Int, val name: String = "")

@Serializable data class TrainerProfile(
    val status: String,
    val name: String = "",
    val bio: String = "",
    val specialization: String = "",
    val approach: String = "",
    val experienceYears: Int? = null,
    val priceOnline: Double? = null,
    val city: String = "",
    val contact: String = "",
    val accepting: Boolean = false,
    val clients: Int = 0,
)

/** `trainer` is null until the account has applied. */
@Serializable data class ProfileResult(val role: String = "", val trainer: TrainerProfile? = null)

/** Only the fields that are set are sent; the server leaves absent fields unchanged. */
@Serializable data class ProfilePatch(
    val name: String? = null,
    val bio: String? = null,
    val specialization: String? = null,
    val approach: String? = null,
    val city: String? = null,
    val contact: String? = null,
    val experienceYears: Int? = null,
    val priceOnline: Int? = null,
    val accepting: Boolean? = null,
)

@Serializable data class SessionRow(
    val id: Int,
    val clientId: Int,
    val clientName: String = "",
    val startsAt: String,
    val durationMin: Int,
    val status: String,
    val price: Double? = null,
    val note: String = "",
)

@Serializable data class SessionsResult(val clients: List<BusinessClient> = emptyList(), val sessions: List<SessionRow> = emptyList())

/** `create` uses clientId, startsAt, durationMin, price, note; `status` uses id + status; `delete` uses id. */
@Serializable data class SessionAction(
    val action: String,
    val id: Int? = null,
    val clientId: Int? = null,
    val startsAt: String? = null,
    val durationMin: Int? = null,
    val price: Int? = null,
    val note: String? = null,
    val status: String? = null,
)

@Serializable data class LedgerRow(
    val clientId: Int,
    val clientName: String = "",
    val sessionsDone: Int = 0,
    val sessionsPlanned: Int = 0,
    val billed: Double = 0.0,
    val paid: Double = 0.0,
    val balance: Double = 0.0,
)

@Serializable data class PaymentRow(
    val id: Int,
    val clientId: Int,
    val clientName: String = "",
    val amount: Double,
    val currency: String = "",
    val paidOn: String = "",
    val note: String = "",
)

/** `currency` is the trainer's currency; the server only sends one, so ledger and totals use it. */
@Serializable data class Totals(val billed: Double = 0.0, val paid: Double = 0.0, val balance: Double = 0.0)

@Serializable data class FinanceResult(
    val currency: String = "",
    val clients: List<BusinessClient> = emptyList(),
    val ledgers: List<LedgerRow> = emptyList(),
    val payments: List<PaymentRow> = emptyList(),
    val totals: Totals = Totals(),
)

@Serializable data class FinanceAction(
    val action: String,
    val id: Int? = null,
    val clientId: Int? = null,
    val amount: Int? = null,
    val note: String? = null,
)

@Serializable data class TemplateRow(val id: Int, val name: String = "")
@Serializable data class TemplatesResult(val templates: List<TemplateRow> = emptyList())

/** `create` uses name + fromClientId; `assign` uses id (template) + clientId; `delete` uses id. */
@Serializable data class TemplateAction(
    val action: String,
    val id: Int? = null,
    val clientId: Int? = null,
    val name: String? = null,
    val fromClientId: Int? = null,
)

@Serializable data class BroadcastBody(val text: String)
@Serializable data class BroadcastResult(val ok: Boolean = false, val sent: Int = 0)

/** Generic write acknowledgement. `id` is set by creates, `pending` by a new trainer application. */
@Serializable data class OkResult(val ok: Boolean = false, val id: Int? = null, val pending: Boolean = false)

class TrainerBusinessApi(private val api: ApiClient) {
    suspend fun profile(): ProfileResult =
        api.unwrap(api.http.get("api/v2/trainer/profile") { api.authorize(this) })

    suspend fun saveProfile(patch: ProfilePatch, key: String): OkResult =
        api.unwrap(api.http.post("api/v2/trainer/profile") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(patch)
        })

    suspend fun sessions(): SessionsResult =
        api.unwrap(api.http.get("api/v2/trainer/sessions") { api.authorize(this) })

    suspend fun sessionAction(body: SessionAction, key: String): OkResult =
        api.unwrap(api.http.post("api/v2/trainer/sessions") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(body)
        })

    suspend fun finance(): FinanceResult =
        api.unwrap(api.http.get("api/v2/trainer/finance") { api.authorize(this) })

    suspend fun financeAction(body: FinanceAction, key: String): OkResult =
        api.unwrap(api.http.post("api/v2/trainer/finance") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(body)
        })

    suspend fun templates(): List<TemplateRow> =
        api.unwrap<TemplatesResult>(api.http.get("api/v2/trainer/templates") { api.authorize(this) }).templates

    suspend fun templateAction(body: TemplateAction, key: String): OkResult =
        api.unwrap(api.http.post("api/v2/trainer/templates") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(body)
        })

    suspend fun broadcast(text: String, key: String): BroadcastResult =
        api.unwrap(api.http.post("api/v2/trainer/broadcast") {
            api.authorize(this)
            header("Idempotency-Key", key)
            contentType(ContentType.Application.Json)
            setBody(BroadcastBody(text))
        })
}
