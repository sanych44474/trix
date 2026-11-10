package app.hacklimits.shared.workout

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SaveEndsRestTest {
    @Test
    fun finishingTheSessionEndsTheRest() {
        assertTrue(saveEndsRest(DockAction.Finish))
    }

    @Test
    fun savingEditsMidSessionLeavesTheRestRunning() {
        assertFalse(saveEndsRest(DockAction.Update), "an offline-queued update used to clear the timer")
        assertFalse(saveEndsRest(DockAction.Backfill("2026-11-09")))
    }
}
