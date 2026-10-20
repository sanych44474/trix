package app.hacklimits.shared.media

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MealDraftTest {
    @Test
    fun macrosScaleWithTheGramsThePersonEdits() {
        val logged = DraftItem(LoggedFood("Rice", 200.0, 4.0, 1.0, 44.0, grams = 150.0), "300").toLogged()
        assertEquals(400.0, logged.kcal)
        assertEquals(88.0, logged.carbs)
        assertEquals(300.0, logged.grams)
    }

    @Test
    fun gramsAreCheckedBeforeTheyAreSent() {
        assertTrue(isValidGrams(""))
        assertTrue(isValidGrams("3000"))
        assertFalse(isValidGrams("0"))
        assertFalse(isValidGrams("3001"))
    }
}
