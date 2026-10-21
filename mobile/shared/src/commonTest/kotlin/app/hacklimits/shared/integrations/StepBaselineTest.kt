package app.hacklimits.shared.integrations

import kotlin.test.Test
import kotlin.test.assertEquals

class StepBaselineTest {
    @Test
    fun theFirstReadingOfADayStartsAtZeroAndLaterOnesCount() {
        val first = readSteps(null, "2026-10-21", 52_000)
        assertEquals(0, first.stepsToday)
        val later = readSteps(first.baseline, "2026-10-21", 55_500)
        assertEquals(3_500, later.stepsToday)
    }

    @Test
    fun aNewDayStartsFromTheCurrentCounter() {
        val yesterday = StepBaseline("2026-10-20", start = 40_000, last = 52_000)
        val today = readSteps(yesterday, "2026-10-21", 52_300)
        assertEquals(0, today.stepsToday)
        assertEquals(52_300, today.baseline.start)
    }

    @Test
    fun aRebootKeepsTheStepsCountedBeforeIt() {
        val before = StepBaseline("2026-10-21", start = 10_000, last = 14_000)
        val afterReboot = readSteps(before, "2026-10-21", 500)
        assertEquals(4_500, afterReboot.stepsToday)
        val later = readSteps(afterReboot.baseline, "2026-10-21", 1_500)
        assertEquals(5_500, later.stepsToday)
    }
}
