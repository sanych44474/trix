package app.hacklimits.shared.workout

import app.hacklimits.shared.data.ExerciseInfo
import app.hacklimits.shared.data.PlatesResponse
import app.hacklimits.shared.data.SwapChoice
import app.hacklimits.shared.data.WorkoutHistoryItem
import app.hacklimits.shared.workout.logic.LoggerExercise
import app.hacklimits.shared.workout.logic.LoggerSet
import app.hacklimits.shared.workout.logic.RestPrefs
import app.hacklimits.shared.workout.logic.SessionClock

/** One set row being typed in: its numbers, and the text as typed ("62," on the way to "62,5"). */
data class RowDraft(val row: Int, val set: LoggerSet, val text: Map<String, String> = emptyMap())

data class RestUi(
    val endAtMs: Long? = null, // absolute deadline; null = no rest running
    val left: Int = 0,
    val over: Int = 0, // seconds past zero: the number that says the session is drifting
    val done: Boolean = false,
    val target: Int = 60, // the planned length, so +15/-15 doesn't rescale the bar
    val label: String = "",
)

data class PlatesUi(
    val kgText: String = "",
    val result: PlatesResponse? = null,
    val busy: Boolean = false,
    val failed: Boolean = false,
)

data class SaveSummary(
    val prExercises: List<String>,
    val newBadges: List<String>,
    val level: Int,
    val leveledUp: Boolean,
    val totalWorkouts: Int,
    val sets: Int,
    val elapsedSec: Int,
    val densityPct: Int?,
    val bestStreak: Int,
    val volumeKg: Double,
    val plannedSets: Int,
)

enum class SyncState { IDLE, PENDING, SYNCED, OFFLINE }

enum class FeelState { IDLE, BUSY, DONE, FAILED }

enum class LoggerTab { TODAY, PLAN, HISTORY }

/** What the dock's one button does. */
sealed interface DockAction {
    data object Finish : DockAction // a day with no saved log yet: ends the session (asks first)
    data object Update : DockAction // an already-saved day with edits
    data class Backfill(val date: String) : DockAction // logging a past day
    data object Saved : DockAction // nothing to save
}

/** A plan exercise was swapped in the session: ask before rewriting the saved plan too. */
data class PlanSwapConfirm(val planName: String, val choice: SwapChoice)

data class LoggerUi(
    val loading: Boolean = true,
    val error: String? = null,
    val date: String = "",
    val title: String = "",
    val exercises: List<LoggerExercise> = emptyList(),
    val logDate: String? = null, // back-filling another day
    val copiedFrom: String? = null, // a "repeat" of a past session
    val saved: Boolean = false, // what is shown is exactly what the server has
    val drafted: Boolean = false, // there is unsaved work
    val savedAtMs: Long? = null,
    val queued: Boolean = false, // saved on the phone, waiting for the network
    val editedAtMs: Long = 0,
    val restoredFromServer: Boolean = false,
    val sync: SyncState = SyncState.IDLE,
    val saving: Boolean = false,
    val clock: SessionClock? = null,
    val dayLogged: Boolean = false,
    val summary: SaveSummary? = null,
    val summaryDate: String? = null,
    val feel: String? = null,
    val feelState: FeelState = FeelState.IDLE,
    val actionError: String? = null,
    val planNoticeName: String? = null,
    val focus: Boolean = false,
    val focusIndex: Int? = null,
    val menuOpen: Boolean = false,
    val musclesOpen: Boolean = false,
    val restPrefsFor: Int? = null,
    val swapFor: Int? = null,
    val swapChoices: List<SwapChoice> = emptyList(),
    val infoFor: Int? = null,
    val info: ExerciseInfo? = null,
    val customOpen: Boolean = false,
    val customName: String = "",
    val busy: String? = null,
    val rest: RestUi = RestUi(),
    val restPrefs: RestPrefs = RestPrefs(),
    val restOverrides: Map<String, Int> = emptyMap(),
    /** The rest last chosen by hand, per metric ("reps"/"time"/"distance"): the starting rest of an
     *  exercise that has no rest of its own yet, so a chosen 1:30 carries over to the next exercise. */
    val restChosen: Map<String, Int> = emptyMap(),
    val rowDrafts: Map<String, RowDraft> = emptyMap(),
    val tab: LoggerTab = LoggerTab.TODAY,
    val history: List<WorkoutHistoryItem>? = null,
    val historyError: String? = null,
    val historyBusy: String? = null,
    val missedDate: String = "",
    val plates: PlatesUi = PlatesUi(),
    val planSwapConfirm: PlanSwapConfirm? = null,
    val finishConfirm: Boolean = false,
    val removeConfirm: Int? = null, // exercise index whose typed sets are about to be deleted
) {
    val dockAction: DockAction
        get() = when {
            logDate != null -> if (saved) DockAction.Saved else DockAction.Backfill(logDate)
            saved -> DockAction.Saved
            dayLogged -> DockAction.Update
            else -> DockAction.Finish
        }
}
