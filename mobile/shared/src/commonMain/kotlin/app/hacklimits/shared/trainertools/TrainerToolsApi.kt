package app.hacklimits.shared.trainertools

import app.hacklimits.shared.data.ApiClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** A saved template as GET /api/v2/trainer/templates lists it. */
@Serializable data class ShareTemplate(val id: Long, val name: String)

@Serializable private data class TemplateList(val templates: List<ShareTemplate> = emptyList())

/** POST /api/v2/trainer/share/template. [link] is set for link mode only. */
@Serializable data class ShareTemplateResult(val ok: Boolean = false, val code: String = "", val name: String = "", val link: String? = null)

/** POST /api/v2/trainer/share/plan: the trainer's own active plan, published to the library. */
@Serializable data class SharePlanResult(val ok: Boolean = false, val code: String = "", val name: String = "")

/** POST /api/v2/trainer/share/assign. */
@Serializable data class AssignResult(val ok: Boolean = false, val assigned: Int = 0, val total: Int = 0)

/** GET /api/v2/trainer/report (trainerApi.ts): the bot's /trreport table as rows, most active first. */
@Serializable
data class TrainerReport(
    val clientCount: Int = 0,
    val active7: Int = 0,
    val activePct: Int = 0,
    val rows: List<Row> = emptyList(),
) {
    @Serializable
    data class Row(
        val id: Long,
        val name: String? = null,
        val username: String? = null,
        val onboarded: Boolean = false,
        val interview: Interview = Interview(),
        val plan: Plan = Plan(),
        val events: Events = Events(),
        val lastSeen: String? = null,
        val botBlocked: Boolean = false,
    )
    @Serializable data class Interview(val filled: Int = 0, val total: Int = 0)
    @Serializable data class Plan(val active: Boolean = false, val draft: Boolean = false)
    @Serializable data class Events(val workouts: Int = 0, val checkins: Int = 0, val nutrition: Int = 0, val steps: Int = 0)
}

/** POST /api/v2/owner/cleanup without confirm: how many inactive users a bulk cleanup would remove. */
@Serializable data class CleanupPreview(val count: Int = 0, val days: Int = 7)

/** POST /api/v2/owner/cleanup with confirm: true. */
@Serializable data class CleanupResult(val deleted: Int = 0)

/**
 * Trainer and owner tools: program sharing, the weekly client report and the owner's inactive
 * cleanup. Mutations carry an Idempotency-Key so a retried tap does not publish or delete twice.
 */
class TrainerToolsApi(private val api: ApiClient) {
    suspend fun templates(): List<ShareTemplate> =
        api.unwrap<TemplateList>(api.http.get("api/v2/trainer/templates") { api.authorize(this) }).templates

    suspend fun publishTemplate(templateId: Long, library: Boolean, key: String): ShareTemplateResult =
        api.unwrap(post("api/v2/trainer/share/template", buildJsonObject {
            put("templateId", templateId)
            put("mode", if (library) "library" else "link")
        }, key))

    suspend fun publishOwnPlan(name: String, key: String): SharePlanResult =
        api.unwrap(post("api/v2/trainer/share/plan", buildJsonObject { put("name", name.take(48)) }, key))

    suspend fun assign(templateId: Long, clientIds: List<Long>, key: String): AssignResult =
        api.unwrap(post("api/v2/trainer/share/assign", buildJsonObject {
            put("templateId", templateId)
            putJsonArray("clientIds") { clientIds.forEach { add(JsonPrimitive(it)) } }
        }, key))

    suspend fun report(): TrainerReport =
        api.unwrap(api.http.get("api/v2/trainer/report") { api.authorize(this) })

    suspend fun cleanupPreview(): CleanupPreview =
        api.unwrap(post("api/v2/owner/cleanup", buildJsonObject {}, null))

    suspend fun cleanupConfirm(key: String): CleanupResult =
        api.unwrap(post("api/v2/owner/cleanup", buildJsonObject { put("confirm", true) }, key))

    private suspend fun post(path: String, body: JsonObject, key: String?): HttpResponse = api.http.post(path) {
        api.authorize(this)
        key?.let { header("Idempotency-Key", it) }
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
