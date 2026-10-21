package app.hacklimits.shared.daily

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DailyLogicTest {
    @Test
    fun oneDecimalMatchesTheBotsFigures() {
        assertEquals("3.0", oneDecimal(3.0))
        assertEquals("3.4", oneDecimal(3.44))
        assertEquals("3.5", oneDecimal(3.46))
        assertEquals("-0.5", oneDecimal(-0.5))
        assertEquals("0.0", oneDecimal(-0.01))
    }

    @Test
    fun stressFallingIsTheGoodDirection() {
        assertTrue(isGoodTrend("energy", 0.4))
        assertFalse(isGoodTrend("energy", -0.4))
        assertTrue(isGoodTrend("stress", -0.4))
        assertFalse(isGoodTrend("stress", 0.4))
        assertEquals("—", trendArrow(0.01))
        assertEquals("▲", trendArrow(0.4))
        assertEquals("▼", trendArrow(-0.4))
    }

    @Test
    fun checklistKeysGoToTheScreenThatLogsThem() {
        assertEquals(ChecklistTarget.Fuel, checklistTargetOf("food"))
        assertEquals(ChecklistTarget.Progress, checklistTargetOf("checkin"))
        assertEquals(ChecklistTarget.Today, checklistTargetOf("water"))
        assertEquals(ChecklistTarget.Today, checklistTargetOf("steps"))
    }

    @Test
    fun hourLabelIsPaddedLocalTime() {
        assertEquals("07:00", hourLabel(7))
        assertEquals("23:00", hourLabel(23))
    }
}
