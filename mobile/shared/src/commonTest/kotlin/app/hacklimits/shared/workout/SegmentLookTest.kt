package app.hacklimits.shared.workout

import app.hacklimits.shared.workout.logic.SegmentLook
import app.hacklimits.shared.workout.logic.segmentLook
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SegmentLookTest {
    @Test
    fun aFinishedExerciseYouWentBackToIsStillMarkedCurrent() {
        val look = segmentLook(index = 2, at = 2, complete = true, filledSets = 3)
        assertTrue(look.current)
        assertEquals(SegmentLook.Progress.COMPLETE, look.progress)
    }

    @Test
    fun otherSegmentsShowOnlyTheirProgress() {
        assertFalse(segmentLook(0, 2, complete = true, filledSets = 3).current)
        assertEquals(SegmentLook.Progress.STARTED, segmentLook(3, 2, complete = false, filledSets = 1).progress)
        assertEquals(SegmentLook.Progress.TODO, segmentLook(4, 2, complete = false, filledSets = 0).progress)
    }
}
