package app.hacklimits.shared.data

import app.hacklimits.shared.account.ReleaseItem
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** GET /api/v2/dashboard (openapi `Dashboard`): every field Today, the week cards and Food's
 * summaries read. Unknown fields are ignored, so the server can grow without breaking the app. */
@Serializable
data class Dashboard(
    val viewer: Viewer,
    val lang: String = "uk",
    val today: String,
    val name: String? = null,
    val calendar: Calendar = Calendar(),
    val weight: Weight = Weight(),
    val whatsnew: WhatsNew? = null,
    val recoverySwap: RecoverySwap? = null,
    val week: Week? = null,
    val badges: List<Badge> = emptyList(),
    val recovery: Recovery = Recovery(),
    val todayStats: TodayStats? = null,
    val logForm: LogForm? = null,
    val macros: Macros = Macros(),
    val exercises: List<Exercise> = emptyList(),
) {
    @Serializable data class Weight(val points: List<Point> = emptyList(), val goal: Double? = null) {
        @Serializable data class Point(val date: String, val kg: Double)
    }

    /** `profileGaps` is absent for trainers and before onboarding (the fine-tune card's input). */
    @Serializable data class Viewer(
        val id: Long,
        val role: String,
        val onboarded: Boolean,
        val planPending: Boolean = false,
        val profileGaps: List<String> = emptyList(),
    )

    @Serializable data class Calendar(
        val days: List<Day> = emptyList(),
        val split: List<Split> = emptyList(),
        val logs: List<Log> = emptyList(),
    ) {
        /** A planned training weekday (1 = Monday). */
        @Serializable data class Split(val weekday: Int, val group: String = "", val n: Int = 0)
        @Serializable data class Day(val date: String, @SerialName("s") val status: String)
        @Serializable data class Log(val date: String, val done: Boolean = false, val ex: List<LogExercise> = emptyList()) {
            @Serializable data class LogExercise(val n: String, val s: Int = 0)
        }
    }

    @Serializable data class WhatsNew(val version: String, val text: String, val items: List<ReleaseItem> = emptyList())

    /** Today's planned muscles are still recovering and a later plan day's are ready. */
    @Serializable data class RecoverySwap(
        val weekday: Int,
        val other: Int,
        val todayGroup: String = "",
        val otherGroup: String = "",
        val tired: List<String> = emptyList(),
        val because: List<String> = emptyList(),
    )

    @Serializable data class Week(
        val weekStart: String = "",
        val balance: Int = 0,
        val balanceStreak: Int = 0,
        val balanceGoal: Int = 1,
        val questXp: Int = 0,
        val quests: List<Quest> = emptyList(),
    ) {
        @Serializable data class Quest(
            val code: String,
            val kind: String,
            val target: Double = 0.0,
            val current: Double = 0.0,
            val done: Boolean = false,
            val muscle: String? = null,
        )
    }

    @Serializable data class Badge(val code: String, val label: String)

    @Serializable data class Recovery(val score: Int = 0, val label: String = "fair", val factors: List<Factor> = emptyList()) {
        @Serializable data class Factor(val code: String, val count: Int = 0)
    }

    @Serializable data class TodayStats(val waterMl: Double = 0.0, val waterGoal: Double = 0.0, val steps: Int = 0, val stepsGoal: Int = 0)

    @Serializable data class LogForm(val exercises: List<String> = emptyList(), val minutes: Int = 0)

    @Serializable data class Macros(val targets: Targets? = null, val days: List<FoodDay> = emptyList()) {
        @Serializable data class Targets(val calories: Double = 0.0, val protein: Double = 0.0, val fats: Double = 0.0, val carbs: Double = 0.0)
        @Serializable data class FoodDay(val date: String, val kcal: Double = 0.0, val p: Double = 0.0, val f: Double = 0.0, val c: Double = 0.0, val training: Boolean = false)
    }

    @Serializable data class Exercise(val name: String, val points: List<Point> = emptyList()) {
        @Serializable data class Point(val date: String, val e1rm: Double)
    }

    /** `trainingToday` is the one derived value: today's ISO weekday is in the split. */
    val trainingToday: Boolean
        get() = runCatching { kotlinx.datetime.LocalDate.parse(today).dayOfWeek.ordinal + 1 }.getOrNull()
            ?.let { wd -> calendar.split.any { it.weekday == wd } } ?: true
}

/** GET /api/v2/weekcard (openapi `WeekCardResponse`): this week's stats for the shareable card. */
@Serializable
data class WeekCardResponse(val card: String? = null, val stats: WeekCardStats? = null, val name: String = "")

@Serializable
data class WeekCardStats(
    val since: String = "",
    val until: String = "",
    val done: Int = 0,
    val planned: Int = 0,
    val totalSets: Int = 0,
    val volumeKg: Double = 0.0,
    val prs: Int = 0,
    val streak: Int = 0,
    val level: Int = 0,
    val xp: Int = 0,
)

class DashboardApi(private val api: ApiClient) {
    suspend fun load(): Dashboard = api.unwrap(api.http.get("api/v2/dashboard") { api.authorize(this) })

    suspend fun weekCard(): WeekCardResponse = api.unwrap(api.http.get("api/v2/weekcard") { api.authorize(this) })

    /** Trades the weekdays of two plan days (Today's recovery-swap card, POST /api/v2/plan dayswap). */
    @OptIn(ExperimentalUuidApi::class)
    suspend fun swapPlanDays(weekday: Int, other: Int) {
        api.unwrap<JsonElement>(api.http.post("api/v2/plan") {
            api.authorize(this)
            header("Idempotency-Key", Uuid.random().toString())
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("action", "dayswap"); put("weekday", weekday); put("other", other) })
        })
    }
}
