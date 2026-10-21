package app.hacklimits.shared.social

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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A squad as GET /api/v2/squads returns it (src/webapp/squadApi.ts GET). `entries` is this week, best first. */
@Serializable
data class Squad(
    val id: Long,
    val app: Boolean = false,
    val inviteLink: String? = null,
    val title: String,
    val memberCount: Int = 0,
    val entries: List<Entry> = emptyList(),
    val total: Int = 0,
    val silent: Int = 0,
) {
    @Serializable data class Entry(val name: String, val workouts: Int, val me: Boolean = false, val medal: String = "")
}

@Serializable private data class SquadList(val squads: List<Squad> = emptyList())

/** create / join / leave. Full squads, unknown codes and the 5-squad cap come back as 200 with
 * `ok = false` and a `reason`, not as an HTTP error, so the caller must read `ok` and `reason`. */
@Serializable
data class SquadResult(val ok: Boolean = false, val reason: String? = null, val id: Long? = null)

/** GET /api/v2/challenges (src/webapp/miscApi.ts handleChallengesApi). */
@Serializable
data class Challenges(
    val active: List<ActiveChallenge> = emptyList(),
    val available: List<AvailableChallenge> = emptyList(),
    val won: Int = 0,
) {
    @Serializable
    data class ActiveChallenge(
        val code: String,
        val emoji: String = "",
        val title: String,
        val current: Int,
        val target: Int,
        val pct: Int,
        val done: Boolean,
        val daysLeft: Int,
    )
    @Serializable data class AvailableChallenge(val code: String, val emoji: String = "", val title: String, val target: Int)
}

/** GET /api/v2/boards (miscApi.ts handleBoardsApi). Boards are absent when the viewer is not opted in. */
@Serializable
data class Boards(
    val optedIn: Boolean = false,
    val consistency: Board? = null,
    val improved: Board? = null,
    val relative: Board? = null,
    val total: Board? = null,
    val streak: Board? = null,
    val recentPrs: Board? = null,
) {
    /** `rank` is 0 when the viewer is not on the board (domain/records.ts rankOf). */
    @Serializable data class Board(val rank: Int = 0, val total: Int = 0, val top: List<Row> = emptyList())
    @Serializable data class Row(val pos: Int, val name: String, val value: Double = 0.0, val detail: String = "", val me: Boolean = false)
}

/** GET /api/v2/buddy (buddyApi.ts). [buddy] is null when the viewer has no accountability partner. */
@Serializable
data class BuddyResponse(val buddy: Buddy? = null) {
    @Serializable
    data class Buddy(
        val name: String = "",
        val level: Int = 1,
        val intoLevel: Int = 0,
        val needed: Int = 0,
        val streak: Int = 0,
        val weekWorkouts: Int = 0,
        val myWeekWorkouts: Int = 0,
    )
}

/** The v2 social routes. Every call goes through ApiClient.unwrap, so errors arrive as ApiException. */
class SocialApi(private val api: ApiClient) {
    suspend fun squads(): List<Squad> =
        api.unwrap<SquadList>(api.http.get("api/v2/squads") { api.authorize(this) }).squads

    /** Creating a squad is not idempotent on its own, so a retried tap must carry the same key. */
    suspend fun createSquad(title: String, key: String): SquadResult =
        api.unwrap(squadPost(buildJsonObject { put("action", "create"); put("title", title.take(40)) }, key))

    suspend fun joinSquad(code: String, key: String): SquadResult =
        api.unwrap(squadPost(buildJsonObject { put("action", "join"); put("code", code) }, key))

    suspend fun leaveSquad(id: Long): SquadResult =
        api.unwrap(squadPost(buildJsonObject { put("action", "leave"); put("id", id) }, null))

    suspend fun challenges(): Challenges = api.unwrap(api.http.get("api/v2/challenges") { api.authorize(this) })

    suspend fun joinChallenge(code: String, key: String) {
        api.unwrap<JsonObject>(post("api/v2/challenges", buildJsonObject { put("code", code) }, key))
    }

    suspend fun boards(): Boards = api.unwrap(api.http.get("api/v2/boards") { api.authorize(this) })

    suspend fun buddy(): BuddyResponse = api.unwrap(api.http.get("api/v2/buddy") { api.authorize(this) })

    /** The leaderboard opt-in is a settings action, not a boards call (settingsApi.ts "compete"). */
    suspend fun setCompete(on: Boolean) {
        api.unwrap<JsonObject>(post("api/v2/settings", buildJsonObject { put("action", "compete"); put("on", on) }, null))
    }

    private suspend fun squadPost(body: JsonObject, key: String?): HttpResponse = post("api/v2/squads", body, key)

    private suspend fun post(path: String, body: JsonObject, key: String?): HttpResponse = api.http.post(path) {
        api.authorize(this)
        key?.let { header("Idempotency-Key", it) }
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
