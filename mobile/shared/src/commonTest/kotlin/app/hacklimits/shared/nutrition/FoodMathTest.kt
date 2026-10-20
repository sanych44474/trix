package app.hacklimits.shared.nutrition

import kotlin.test.Test
import kotlin.test.assertEquals

class FoodMathTest {
    @Test
    fun progressIsTheShareOfTheGoalCappedAtFull() {
        assertEquals(0.5f, progressFraction(1200.0, 2400.0))
        assertEquals(1f, progressFraction(3000.0, 2400.0))
    }

    @Test
    fun withoutAGoalThereIsNoProgress() {
        assertEquals(0f, progressFraction(120.0, null))
        assertEquals(0f, progressFraction(120.0, 0.0))
    }

    @Test
    fun gramsShowWithoutADecimalPointWhenWhole() {
        assertEquals("80", formatGrams(80.0))
        assertEquals("80.5", formatGrams(80.5))
    }
}
