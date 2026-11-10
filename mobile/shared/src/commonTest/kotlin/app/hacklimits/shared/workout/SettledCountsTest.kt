package app.hacklimits.shared.workout

import app.hacklimits.shared.workout.logic.settled
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class SettledCountsTest {
    @Test
    fun aDraftThatSendsAtOnceNeverShows() = runTest {
        // queued (1), sent 300 ms later (0): only the settled 0 comes through.
        val seen = flow { emit(0); delay(5_000); emit(1); delay(300); emit(0) }.settled(2_000).toList()
        assertEquals(listOf(0, 0), seen)
    }

    @Test
    fun aCountThatHoldsIsShown() = runTest {
        // Offline: the draft stays queued, so the note appears once it has held.
        val seen = flow { emit(1); delay(10_000) }.settled(2_000).toList()
        assertEquals(listOf(1), seen)
    }
}
