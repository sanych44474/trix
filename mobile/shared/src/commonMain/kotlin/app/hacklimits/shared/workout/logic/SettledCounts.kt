package app.hacklimits.shared.workout.logic

import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.debounce

/** How long a queue count must hold before the logger shows it. */
const val SYNC_BANNER_SETTLE_MS = 2_000L

/**
 * The sync queue's counts, passed on only once they have held for [settleMs]. Every draft autosave
 * goes through the queue: the count is 1 for the moment it takes to send, then 0, so the
 * "pending sync: 1" note flashed on every edit, too fast to read. A count that persists (no network)
 * still shows, after [settleMs].
 */
@OptIn(FlowPreview::class)
fun <T> Flow<T>.settled(settleMs: Long = SYNC_BANNER_SETTLE_MS): Flow<T> = debounce(settleMs)
